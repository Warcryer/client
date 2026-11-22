import { d, t } from "./words";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chat } from "./chat";
import { ApiError, crestUrl, rpc, type ClanSummary, type Info } from "./api";
import { getToken, signOut } from "./auth";
import { CONTROL_URLS, isDesktop, SERVER } from "./config";
import { ControlClient, type ControlState, type GroupInfo, type NetSet, type PresenceEntry } from "./control";
import { refreshGame, useGame } from "./game";
import { setLanguage, useLanguage } from "./i18n";
import { usePendingInvite } from "./invite";
import { engine } from "./runtime";
import { useSettings } from "./settings";
import { publishStrip } from "./strip/publish";
import { useUpdate } from "./update";
import { AppContext, type Tab } from "./ui/app-context";
import { AllianceView } from "./ui/AllianceView";
import { AudioToggles } from "./ui/AudioToggles";
import { ClanView } from "./ui/ClanView";
import { netName, useEngine, Wordmark } from "./ui/common";
import { GuidesView } from "./ui/GuidesView";
import { HistoryView } from "./ui/HistoryView";
import { InviteAsk } from "./ui/InviteAsk";
import { LeaderLostBar } from "./ui/LeaderLostBar";
import { Help } from "./ui/tips";
import { NameStep } from "./ui/NameStep";
import { Notices } from "./ui/Notices";
import { RosterView } from "./ui/RosterView";
import { SettingsPanel } from "./ui/SettingsPanel";
import { SignIn } from "./ui/SignIn";
import { SwordLoader } from "./ui/SwordLoader";
import { VoiceView } from "./ui/VoiceView";
import { Wizard } from "./ui/Wizard";

type Phase = "signin" | "running" | "replaced";

// The labels go through t() where shown.
const TABS: { id: Tab; label: string }[] = [
  { id: "voice", label: "Voice" },
  { id: "roster", label: "Operations" },
  { id: "clan", label: "Clan" },
  { id: "alliance", label: "Alliance" },
  { id: "history", label: "History" },
  { id: "guides", label: "Guides" },
];

/** Idle this long (no key or mouse input on the computer at all), the player shows as away. */
const AWAY_IDLE_S = 15 * 60;

export default function App() {
  const s = useSettings();
  const eng = useEngine();
  const update = useUpdate();
  const [token, setToken] = useState<string | null>(getToken);
  // The browser version has no token: it tries the site's cookie and falls back to the sign-in screen.
  const [phase, setPhase] = useState<Phase>(isDesktop && !token ? "signin" : "running");
  const [attempt, setAttempt] = useState(0);
  const [info, setInfo] = useState<Info | null>(null);
  const [set, setSet] = useState<NetSet | null>(null);
  const [state, setState] = useState<ControlState>("connecting");
  const [notice, setNotice] = useState("");
  const [signInNotice, setSignInNotice] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [tick, setTick] = useState(0);
  /** Bumped only by changes that may reach beyond one operation: clans, crests, lounges. */
  const [wideTick, setWideTick] = useState(0);
  /** The alliance's groups as last sent by the control service; null until it first sends them. */
  const [groups, setGroups] = useState<GroupInfo[] | null>(null);
  /** Who in the alliance has the app open, by player; null until the control service has said. */
  const [presence, setPresence] = useState<ReadonlyMap<number, PresenceEntry> | null>(null);
  /** Away: the player's own switch, and Windows saying the computer has been idle (desktop only). */
  const [awayByHand, setAwayByHand] = useState(false);
  const [awayIdle, setAwayIdle] = useState(false);
  const [tab, setTab] = useState<Tab>("voice");
  const [boardOp, setBoardOp] = useState<number | null>(null);
  const [crests, setCrests] = useState<ReadonlyMap<number, number>>(new Map());
  const control = useRef<ControlClient | null>(null);
  const retry = useRef<number | undefined>(undefined);
  const refreshInfoRef = useRef<() => void>(() => {});

  const leave = useCallback((why: string) => {
    void engine.stop();
    setSet(null);
    setInfo(null);
    if (isDesktop) {
      void signOut();
      setToken(null);
    }
    setSignInNotice(why);
    setPhase("signin");
  }, []);

  const refreshInfo = useCallback(() => {
    rpc<Info>("me")
      .then(setInfo)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return leave(isDesktop ? "You were signed out. Sign in again to continue." : "");
        // The server could not be reached. Keep trying rather than sitting on "Connecting…" for good.
        window.clearTimeout(retry.current);
        retry.current = window.setTimeout(() => refreshInfoRef.current(), 4000);
      });
  }, [leave]);
  refreshInfoRef.current = refreshInfo;

  useEffect(() => {
    if (phase !== "running") return;
    refreshInfo();
    const c = new ControlClient(CONTROL_URLS, token);
    control.current = c;
    c.setHeadset(engine.deafened);
    chat.attach(c);
    chat.onCue = (kind) => engine.cue(kind);
    let noticeTimer: number | undefined;
    let me: number | null = null;
    let wasOffline = false;
    c.onHello = (who) => {
      me = who.id;
      // Back after a gap: what was written meanwhile is asked for once the net set has come.
      wasOffline = true;
    };
    c.onState = setState;
    c.onNetSet = (next) => {
      setSet(next);
      void engine.apply(next);
      chat.onNetSet(next, me);
      if (wasOffline) {
        wasOffline = false;
        chat.resync();
      }
      if (next.notice) {
        engine.cue("moved");
        setNotice(
          next.notice.kind === "leader"
            ? `You now lead ${next.notice.party ?? t("your party")}. You are on Command: bind a Command key if you have not.`
            : next.notice.party
              ? `You were moved to ${next.notice.party}.`
              : "You were moved to Reserve.",
        );
        window.clearTimeout(noticeTimer);
        noticeTimer = window.setTimeout(() => setNotice(""), next.notice.kind === "leader" ? 15000 : 8000);
      }
    };
    // A change notice makes the app ask the server for fresh data. With hundreds of players connected,
    // everyone asking at once on every single roster move would be a stampede, so: at most one refresh
    // every two seconds (the first is immediate), spread out by a random moment, and the clan list (for
    // crests) only when the change was not confined to one operation's roster.
    let refreshTimer: number | undefined;
    let refreshedAt = 0;
    let wide = false;
    // Groups come and go often in an evening: the control service sends the whole list, so nobody asks for it.
    c.onGroups = setGroups;
    c.onPresence = (u) =>
      setPresence((had) => {
        const next = new Map(u.full ? [] : (had ?? []));
        for (const id of u.gone) next.delete(id);
        for (const e of u.set) next.set(e.userId, e);
        return next;
      });
    c.onChanged = (operationId) => {
      if (operationId === null) wide = true;
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(
        () => {
          refreshTimer = undefined;
          refreshedAt = Date.now();
          if (wide) setWideTick((n) => n + 1);
          wide = false;
          setTick((n) => n + 1);
          refreshInfo();
        },
        Math.max(0, refreshedAt + 2000 - Date.now()) + Math.random() * 400,
      );
    };
    c.onEnded = (why) => {
      if (why === "replaced") {
        void engine.stop();
        setSet(null);
        return setPhase("replaced");
      }
      leave(isDesktop ? "You were signed out. Sign in again to continue." : "");
    };
    engine.onNeedRefresh = () => c.refresh();
    engine.onVoiceDropped = (what) => c.reportVoice(what);
    c.start();
    return () => {
      window.clearTimeout(noticeTimer);
      window.clearTimeout(refreshTimer);
      window.clearTimeout(retry.current);
      c.stop();
      control.current = null;
      setPresence(null);
      chat.attach(null);
      void engine.stop();
    };
  }, [phase, token, attempt, refreshInfo, leave]);

  // The others in the player's rooms see when their headset is off (decision 59).
  const deafened = eng.deafened;
  useEffect(() => {
    control.current?.setHeadset(deafened);
  }, [deafened]);

  // The operation's text chat. The chat window (the strip, opened out) is handed it with everything else.
  const chatView = useSyncExternalStore(chat.subscribe, chat.view);
  // The compact strip shows the nets with someone speaking. It has no connection of its own, so tell it on every change.
  useEffect(() => {
    const nets = phase === "running" && set ? eng.view() : [];
    publishStrip({
      where: phase === "running" && set ? (set.operation?.name ?? nets.find((n) => n.net === "lounge")?.label ?? null) : null,
      lines: nets
        .filter((n) => n.live || n.speakers.length > 0)
        .map((n) => ({
          net: n.net,
          label: n.label,
          // The strip has no words of its own: it is told what to call each net. A party goes by its
          // own name; a lounge's full name is too long for the strip's column.
          short: n.net === "party" || n.net === "group" ? n.label : n.net === "lounge" && n.room.startsWith("lounge-alliance") ? t("Alliance") : netName(n.net),
          you: n.live,
          lowered: n.lowered,
          speakers: n.speakers.map((sp) => {
            const version = sp.clanId === null ? undefined : crests.get(sp.clanId);
            return { name: sp.name, crest: sp.clanId !== null && version ? crestUrl(sp.clanId, version) : null, tag: sp.clanTag };
          }),
        })),
      muted: eng.muteAll,
      deafened: eng.deafened,
      locked: eng.broadcastLocked,
      // The chat window shows the latest lines; the whole of a long evening need not cross to it on every change.
      chat: { ...chatView, lines: Object.fromEntries(Object.entries(chatView.lines).map(([room, lines]) => [room, lines.slice(-120)])) },
    });
  });

  // Away (decision 64, step 1b): the player's own switch, or the computer idle for a quarter of an hour.
  const away = awayByHand || awayIdle;
  useEffect(() => {
    control.current?.setAway(away);
  }, [away, state]);
  useEffect(() => {
    if (phase !== "running" || !isDesktop) return;
    // Windows' own count of how long since any key or mouse input: never which keys, only how long ago.
    const check = () =>
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<number>("idle_seconds"))
        .then((s) => setAwayIdle(typeof s === "number" && s >= AWAY_IDLE_S))
        .catch(() => {});
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // An invite link that was opened: once the player is signed in and set up, the app asks before using it (InviteAsk, below).
  const pendingInvite = usePendingInvite();
  const settled = phase === "running" && info?.user.nameSet === true && s.wizardDone;

  // Which clans have a crest. Reloaded when the server reports a change wider than one operation's roster.
  const named = info?.user.nameSet === true;
  useEffect(() => {
    if (phase !== "running" || !named) return;
    rpc<ClanSummary[]>("clans.list")
      .then((list) => setCrests(new Map(list.filter((c) => c.crest > 0).map((c) => [c.id, c.crest]))))
      .catch(() => {});
  }, [phase, named, wideTick]);
  // The game setup too: an admin may have changed the classes or the party size.
  useEffect(() => {
    if (wideTick > 0) refreshGame();
  }, [wideTick]);
  // And when the player comes into another alliance, or out of one: its lists and its words are its own.
  const allianceId = info?.alliance?.id ?? null;
  useEffect(() => {
    if (info) refreshGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allianceId]);
  // Read here so that the whole app is drawn again when the alliance's words change.
  useGame();
  // The player's language (server decision 66): the app is shown in it once it has a catalogue for it. Read
  // here so that the whole app is drawn again when it changes.
  useLanguage();
  const lang = info?.user.lang;
  useEffect(() => {
    if (lang !== undefined) void setLanguage(lang);
  }, [lang]);

  if (phase === "signin") {
    return (
      <SignIn
        notice={signInNotice}
        onToken={(t) => {
          setSignInNotice("");
          setToken(t);
          setPhase("running");
        }}
      />
    );
  }

  if (phase === "replaced") {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="panel max-w-sm p-8 flex flex-col gap-4 text-center">
          <Wordmark className="text-lg" />
          <p>This account connected from somewhere else, so this one was disconnected.</p>
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPhase("running");
                setAttempt((n) => n + 1);
              }}
            >
              Reconnect here
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-3 text-center" role="status">
          <SwordLoader progress={null} />
          <p className="text-text-muted">Connecting…</p>
        </div>
      </main>
    );
  }
  if (!info.user.nameSet) return <NameStep onSaved={refreshInfo} />;
  if (!s.wizardDone) return <Wizard />;

  // Nets your mic is open on right now: the header's mic turns green.
  const onAir = eng.view().filter((n) => n.live).map((n) => (n.net === "lounge" || n.net === "party" || n.net === "group" ? n.label : netName(n.net)));

  const go = (next: Tab, opId?: number) => {
    setTab(next);
    setBoardOp(next === "roster" ? (opId ?? null) : null);
  };

  return (
    <AppContext.Provider
      value={{ info, refreshInfo, tick, groups, presence, away, awayByHand, setAwayByHand, set, control: state, select: (t) => control.current?.select(t), tab, go, boardOp, notice, crests }}
    >
      <div className="frame flex h-full flex-col">
        <header className="flex items-center gap-x-4 border-b border-gold-dim bg-bg-1/85 px-4 py-2" data-header>
          <Wordmark />
          <nav className="flex shrink-0 gap-0.5" aria-label="Screens">
            {TABS.filter((x) => (x.id !== "alliance" || info.user.runsAlliance) && (x.id !== "history" || info.user.runsAlliance || info.membership?.status === "active")).map((x) => (
              <button
                key={x.id}
                type="button"
                aria-current={tab === x.id ? "page" : undefined}
                onClick={() => go(x.id)}
                className={`whitespace-nowrap border-b-2 px-2.5 py-1 cursor-pointer transition-colors duration-150 ${
                  tab === x.id ? "border-gold text-gold-bright" : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {t(x.label)}
                {x.id === "roster" && info.joinRequests.length > 0 && (
                  <span className="ml-2 rounded-sm bg-gold px-1.5 text-xs font-semibold text-bg-0" aria-label={t(`${d(info.joinRequests.length)} asking to join your party`)}>{info.joinRequests.length}</span>
                )}
                {x.id === "roster" && (info.openSignups?.length ?? 0) > 0 && (
                  <span className="ml-2 rounded-sm border border-gold px-1.5 text-xs font-semibold text-gold" aria-label={`${info.openSignups?.length} waiting for your answer`}>?</span>
                )}
                {x.id === "clan" && info.pendingApprovals > 0 && (
                  <span className="ml-2 rounded-sm bg-gold px-1.5 text-xs font-semibold text-bg-0" aria-label={`${info.pendingApprovals} waiting for approval`}>{info.pendingApprovals}</span>
                )}
              </button>
            ))}
          </nav>
          {/* One row at every size the window allows: the tabs keep their width, the names on the right give way. */}
          <span className="ml-auto flex min-w-0 items-center gap-2.5">
            {state !== "online" && (
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-danger">
                Server link lost, retrying…
                <Help text="The link that delivers roster changes dropped. Your voice keeps working, and it reconnects by itself." />
              </span>
            )}
            {info.alliance && <span className="hidden min-w-0 truncate text-text-muted min-[1180px]:inline" data-alliance-name>{info.alliance.name}</span>}
            <AudioToggles micOff={eng.muteAll} headsetOff={eng.deafened} live={onAir.length > 0} onMic={() => engine.toggleMuteAll()} onHeadset={() => engine.toggleDeafen()} />
            <Help text="The mic and the headset. Click either to turn it off or on; red and crossed out means off. The mic turns green while it is open; the line at the foot of the Voice screen says on which net. With the headset off you hear no one and your mic is off too. The Mute all and Headset keys in Settings do the same from inside the game. While your headset is off, the others in your nets see it beside your name; your mic being off is not shown." />
            <span className="flex min-w-0 items-baseline text-text-muted" data-me>
              <span className="truncate">{info.user.name}</span>
              {info.user.classTag && <span className="ml-1 shrink-0 text-gold">{info.user.classTag}</span>}
            </span>
            <button type="button" className="btn btn-quiet shrink-0 px-3 py-1 text-sm" onClick={() => setShowSettings(true)}>Settings</button>
          </span>
        </header>

        {/* Everything that waits for an answer, on one line: see Notices. */}
        <Notices update={update} />

        {eng.broadcastLocked && (
          <div className="flex flex-wrap items-center gap-3 border-b border-net-broadcast bg-bg-2 px-4 py-2" role="alert">
            <span className="pulse h-2 w-2 rounded-full bg-net-broadcast" />
            <span>
              <span className="font-semibold text-net-broadcast">Broadcast is locked open.</span> {t("Everyone in the operation hears you.")}
            </span>
            <button type="button" className="btn text-sm" onClick={() => engine.setBroadcastLock(false)}>Release</button>
            <span className="text-xs text-text-muted">Your Broadcast key releases it too. It releases by itself after ten minutes.</span>
          </div>
        )}
        {set?.operation && (set.leaderLost ?? []).map((lost) => <LeaderLostBar key={lost.partyId} opId={set.operation!.id} lost={lost} myId={info.user.id} />)}

        <div key={tab} className="rise min-h-0 flex-1 overflow-y-auto">
          {tab === "voice" && <VoiceView />}
          {tab === "roster" && <RosterView />}
          {tab === "clan" && <ClanView />}
          {tab === "alliance" && info.user.runsAlliance && <AllianceView />}
          {tab === "history" && <HistoryView />}
          {tab === "guides" && <GuidesView />}
        </div>

        {settled && pendingInvite && (
          <InviteAsk
            key={pendingInvite}
            onDone={() => {
              refreshInfo();
              setTab("clan");
              setBoardOp(null);
            }}
          />
        )}

        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onSignOut={() => {
              setShowSettings(false);
              if (isDesktop) leave("");
              else window.location.href = `${SERVER}/`; // the browser's session belongs to the site
            }}
          />
        )}
      </div>
    </AppContext.Provider>
  );
}
