import { t } from "../words";
import { SignupPrompts } from "./Signup";
import { useEffect, useState, useSyncExternalStore } from "react";
import { chat } from "../chat";
import { openChatWindow } from "../strip/publish";
import { HeadsetIcon } from "./AudioToggles";
import { ChatPanel } from "./ChatPanel";
import { GroupsPanel } from "./GroupsPanel";
import { OnlinePanel } from "./OnlinePanel";
import { isDesktop } from "../config";
import type { Member, NetView } from "../engine";
import { keyLabel } from "../keys";
import { engine } from "../runtime";
import { bindTargetOf, setSettings, useSettings, type BindTarget, type CallTarget } from "../settings";
import { rpc } from "../api";
import { useAct, useApp } from "./app-context";
import { ClanCrest, ClanMark, Initial, KeyBind, NET_BORDER, netName, NET_TEXT, netTip, NET_VAR, useEngine } from "./common";
import { Help } from "./tips";

const STATE_TEXT: Record<NetView["state"], string> = {
  connecting: "Connecting…",
  connected: "",
  relinking: "Relinking… you still hear this net; a key pressed now is not heard until it is back.",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected, retrying…",
};

const TALK = new Set(["party", "reserve", "lounge", "group"]);
/** Rooms between operations: talked in with the Party key, one at a time, chosen with Talk here. */
const between = (net: string) => net === "lounge" || net === "group";

/** One player on a net. Clicking someone else opens your own volume and mute for them. */
function MemberCard({ m, colour, open, onToggle }: { m: Member; colour: string; open: boolean; onToggle: () => void }) {
  const s = useSettings();
  const quiet = m.muted || m.volume < 1;
  return (
    <li className={`flex flex-col rounded-sm border ${colour} ${m.speaking && !m.muted ? "speaking border-current" : "border-line"}`}>
      <button
        type="button"
        disabled={m.self}
        aria-expanded={m.self ? undefined : open}
        onClick={onToggle}
        className={`flex items-center gap-2 px-2 py-1.5 text-left ${m.self ? "cursor-default" : "cursor-pointer"}`}
      >
        <Initial name={m.name} className={m.speaking && !m.muted ? "border-current text-current" : ""} />
        <span className={`truncate font-medium ${m.self ? "text-gold-bright" : m.muted ? "text-text-muted line-through" : "text-text"}`}>{m.name}</span>
        {m.classTag && <span className="text-xs text-gold">{m.classTag}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-text-muted">
          {quiet && <span>{m.muted ? "muted" : `${Math.round(m.volume * 100)}%`}</span>}
          {!m.canSpeak && <span>listening</span>}
          {m.headsetOff && (
            <span className="flex items-center text-danger" role="img" aria-label={m.self ? "Your headset is off: you hear no one" : `${m.name} has their headset off and hears no one`} data-headset-off>
              <HeadsetIcon off size={15} />
            </span>
          )}
          <ClanMark clanId={m.clanId} tag={m.clanTag} size={18} />
        </span>
      </button>
      {open && !m.self && (
        <div className="flex items-center gap-2 border-t border-line px-2 py-1.5 text-xs text-text-muted">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={m.volume}
            disabled={m.muted}
            aria-label={`Your volume for ${m.name}`}
            className="min-w-0 flex-1"
            onChange={(e) => setSettings({ playerVolume: { ...s.playerVolume, [m.identity]: Number(e.target.value) } })}
          />
          <button
            type="button"
            className={`btn px-2 py-0.5 text-xs ${m.muted ? "" : "btn-quiet"}`}
            onClick={() => setSettings({ playerMuted: { ...s.playerMuted, [m.identity]: !m.muted } })}
          >
            {m.muted ? "Unmute" : "Mute"}
          </button>
        </div>
      )}
    </li>
  );
}

function NetCard({
  net,
  talkHere,
  onTalkHere,
  shown,
  onShow,
}: {
  net: NetView;
  talkHere: boolean;
  onTalkHere?: () => void;
  shown: boolean;
  onShow: () => void;
}) {
  const s = useSettings();
  const key = s.bindings[bindTargetOf(net.net)];
  const voice = s.partyMode === "voice" && TALK.has(net.net);
  const how = net.locked
    ? "Locked open: everyone hears you"
    : !net.speak
    ? "Listen only"
    : between(net.net) && !talkHere
      ? "Listening"
      : voice && key === null
        ? "Voice activated"
        : key !== null
          ? `Hold ${keyLabel(key)}${voice ? " or just speak" : ""}`
          : "No key bound";
  const howTip = !net.speak
    ? "You can hear this net but not speak on it."
    : between(net.net) && !talkHere
      ? "You hear this room. Click Talk here to speak in it instead."
      : key === null && !voice
        ? "Bind a key in Settings to speak here."
        : "Change how you speak in Settings.";
  const help = [netTip(net.net), howTip, net.lowered ? "Lowered: a higher net is live, so you hear this one quieter until it stops. Nothing is muted. Change this under Settings, Priority." : "", onTalkHere && !talkHere ? "Talk here makes this the room your key and voice go to. You keep hearing the others." : ""].filter(Boolean).join("\n");
  // A clan's own rooms carry its crest.
  const clanRoom = /^lounge-clan-(\d+)$|^op-\d+-clan-(\d+)$/.exec(net.room);
  const clanId = clanRoom ? Number(clanRoom[1] ?? clanRoom[2]) : null;
  return (
    <li
      className={`panel border-l-4 ${NET_BORDER[net.net]} px-3 py-2 flex flex-col gap-1 ${net.live || shown ? "bg-bg-2" : ""}`}
      // Glows in the net's colour while your mic is open on it.
      style={net.live ? { boxShadow: `0 0 0 1px ${NET_VAR[net.net]}, 0 0 16px -4px ${NET_VAR[net.net]}` } : undefined}
    >
      <div className="flex items-center gap-1">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer" onClick={onShow} aria-pressed={shown}>
          <ClanCrest clanId={clanId} size={18} />
          <span className={`title min-w-0 break-words text-sm ${NET_TEXT[net.net]}`}>{net.label}</span>
          {net.label !== netName(net.net) && net.net !== "lounge" && <span className="text-xs text-text-muted">{netName(net.net)}</span>}
          <span className="ml-auto text-xs text-text-muted tabular-nums">{net.members.length}</span>
        </button>
        <Help text={help} />
      </div>
      {net.state !== "connected" ? (
        <span className={`text-xs ${net.state === "relinking" ? "text-gold" : "text-danger"}`} data-net-state={net.state}>{STATE_TEXT[net.state]}</span>
      ) : (
        <div className={`min-h-5 truncate transition-opacity duration-150 ${net.lowered ? "opacity-50" : ""}`}>
          {net.live && <span className={`font-semibold ${NET_TEXT[net.net]}`}>You </span>}
          {net.speakers.map((sp, i) => (
            <span key={sp.identity} className="mr-1 inline-flex items-center gap-1 align-middle">
              {i > 0 && <span>,</span>}
              {sp.name}
              <span className="text-xs text-text-muted"><ClanMark clanId={sp.clanId} tag={sp.clanTag} size={14} /></span>
            </span>
          ))}
          {!net.live && net.speakers.length === 0 && <span className="text-text-muted">Quiet</span>}
        </div>
      )}
      <div className="flex items-center text-xs text-text-muted">
        <span>{how}</span>
        {net.lowered && <span className="ml-auto uppercase tracking-wider text-gold" aria-label="Lowered while a higher net is live">Lowered</span>}
        {onTalkHere && !talkHere && (
          <button type="button" className="ml-auto text-gold hover:text-gold-bright cursor-pointer" onClick={onTalkHere}>Talk here</button>
        )}
        {net.canLock && net.state === "connected" && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" className={`cursor-pointer ${net.locked ? "font-semibold text-net-broadcast" : "text-gold hover:text-gold-bright"}`} onClick={() => engine.setBroadcastLock(!net.locked)}>
              {net.locked ? "Release" : "Lock open"}
            </button>
            <Help text={t("For a briefing. Lock open keeps your mic open on Broadcast without holding a key, so everyone in the operation hears you until you release it.\nIt ends when you click Release, press your Broadcast key or your Mute all key, when the operation ends, and by itself after ten minutes.\nYou can also bind a Broadcast lock key in Settings to switch it without leaving the game.")} />
          </span>
        )}
      </div>
    </li>
  );
}

// t() where shown.
const LOUNGE_CHAT_HELP = [
  "Text between operations: a channel for your group, your clan's lounge, and the alliance's lounge if it is on. Its lines are read by whoever is in that room.",
  "Everyone in a room may write in it. Point at a line of your own to remove it; your clan's leader and officers can remove lines in its lounge, and the alliance's admins anywhere.",
  "A lounge's lines are kept for as long as your alliance's admins keep an operation's, and at least a day. A group's go when the group ends.",
  "Open as a window: a small window that stays on top of the game. Quick calls go to your group, or to your clan's lounge when you are in none.",
].join("\n");
// t() where shown.
const CHAT_HELP = [
  "Text for this operation. There is a channel for each of your nets, and its lines are read by whoever is on that net.",
  "Who may write follows who may speak, unless your alliance's admins have opened a channel to everyone.",
  "Point at a line of your own to remove it. Those who run the operation can remove any line they can read, and switch a player's writing off.",
  "Lines are kept with the operation for as long as your alliance's admins have chosen, and can be read back on its board afterwards.",
  "Open as a window: a small window that stays on top of the game, where the game's own chat box is. Bind a Chat key in Settings to type in it without leaving the game.",
].join("\n");

export function VoiceView() {
  const { info, set, select, go, notice, refreshInfo } = useApp();
  const chatView = useSyncExternalStore(chat.subscribe, chat.view);
  const act = useAct();
  const answer = (r: { opId: number; partyId: number; userId: number }, accept: boolean) =>
    void act.run(() => rpc("party.answerJoin", { ...r, accept })).then(refreshInfo);
  const eng = useEngine();
  const s = useSettings();
  const nets = eng.view();
  const op = set?.operation ?? null;
  const [, tick] = useState(0);
  /** The net whose people fill the centre panel; null follows your party or lounge. */
  const [shownRoom, setShownRoom] = useState<string | null>(null);
  const [openMember, setOpenMember] = useState<string | null>(null);

  // Playback permission can change without an engine event.
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 2000);
    return () => window.clearInterval(t);
  }, []);

  const lounges = nets.filter((n) => between(n.net));
  const loungeRoom = eng.loungeRoom;
  // The net you chat on: your party, Reserve while you have none, or the group or lounge you talk in.
  const home =
    nets.find((n) => n.net === "party") ?? nets.find((n) => n.net === "reserve") ?? lounges.find((n) => n.room === loungeRoom) ?? lounges[0] ?? null;

  const shown = nets.find((n) => n.room === shownRoom) ?? home;

  // Speaking nets with no key yet: a new leader is prompted to bind theirs.
  const voiceMode = s.partyMode === "voice";
  const unbound = [
    ...new Set(
      nets
        .filter((n) => n.speak && s.bindings[bindTargetOf(n.net)] === null && !(voiceMode && TALK.has(n.net)))
        .map((n) => bindTargetOf(n.net)),
    ),
  ];
  const hints = [...new Set(nets.filter((n) => n.speak).map((n) => bindTargetOf(n.net)))].filter((t) => s.bindings[t] !== null) as Exclude<BindTarget, "muteAll" | "deafen" | "broadcastLock" | "chat" | "ready" | CallTarget>[];

  // What the footer says when it has no key to list for the nets on screen.
  const speakNets = nets.filter((n) => n.speak);
  const idleHint =
    speakNets.length === 0 ? "You are listening only on these nets."
    : voiceMode && speakNets.every((n) => TALK.has(n.net)) ? "Voice activation is on."
    : Object.values(s.bindings).some((code) => code !== null) ? "The keys you have bound are for other nets. Open Settings to bind one for these."
    : "No keys bound. Open Settings to bind them.";

  const hasLive = set?.operations.some((o) => o.state === "live") ?? false;
  const where = op ? String(op.id) : "lounge";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <span className="text-text-muted">You are in</span>
        {set && set.operations.length > 0 ? (
          <select
            className="field w-auto"
            value={where}
            aria-label="Where you are"
            onChange={(e) => {
              // Picking the lounge during a live operation is a deliberate choice to sit it out.
              if (e.target.value === "lounge") select(hasLive ? "lounge" : "auto");
              else select(Number(e.target.value));
            }}
          >
            <option value="lounge">Lounge</option>
            {set.operations.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.state === "live" ? "live" : "planned"})</option>
            ))}
          </select>
        ) : (
          <span className="font-medium">{op ? op.name : "the lounge"}</span>
        )}
        <Help text={t("Between operations you are in your clan's lounge. A live operation pulls you onto its nets by itself and returns you when it ends.\nIf operations are listed here, pick the lounge to sit one out, or a planned operation to form up early.")} />
        {op && (
          <span className={`text-xs uppercase tracking-wider ${op.state === "live" ? "text-net-party" : "text-gold"}`}>
            {op.state === "live" ? "Live" : "Planned"}
          </span>
        )}
        {op && (
          <button type="button" className="ml-auto text-text-muted hover:text-gold cursor-pointer" onClick={() => go("roster", op.id)}>
            Open the roster board
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden">
        {eng.audioBlocked && (
          <div className="panel flex items-center gap-3 px-3 py-2 border-danger">
            <span>Your browser is holding the sound back until you click.</span>
            <button type="button" className="btn text-sm" onClick={() => void engine.unlockAudio()}>Enable audio</button>
          </div>
        )}
        {eng.micError && (
          <div className="panel flex items-center gap-3 px-3 py-2 border-danger" role="alert">
            <span>Microphone problem: {eng.micError}. You can listen but not speak.</span>
            <button type="button" className="btn text-sm" onClick={() => void engine.startMic().catch(() => {})}>Try again</button>
          </div>
        )}
        {notice && <div className="panel px-3 py-2 text-gold-bright border-gold-bright" role="status">{notice}</div>}
        {info.joinRequests.map((r) => (
          <div key={`${r.opId}-${r.userId}`} className="panel flex flex-wrap items-center gap-3 px-3 py-2 border-gold" role="status">
            <span>
              <span className="font-semibold">{r.name}</span>
              {r.classTag && <span className="ml-1 text-xs text-gold">{r.classTag}</span>} asks to join{" "}
              <span className="font-semibold text-net-party">{r.partyName}</span>
            </span>
            <span className="ml-auto flex gap-2">
              <button type="button" className="btn text-sm" disabled={act.busy} onClick={() => answer(r, true)}>Accept</button>
              <button type="button" className="btn btn-quiet text-sm" disabled={act.busy} onClick={() => answer(r, false)}>Decline</button>
            </span>
          </div>
        ))}
        <SignupPrompts />
        {act.error && <div className="text-danger" role="alert">{act.error}</div>}
        {unbound.length > 0 && (
          <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
            <span>You can speak here. Bind a key for each:</span>
            {unbound.map((t) => (
              <span key={t} className="inline-flex items-center gap-2">
                <span className={`font-semibold ${NET_TEXT[t]}`}>{t === "party" && !op ? "Lounge" : netName(t)}</span>
                <KeyBind target={t} label={netName(t)} />
              </span>
            ))}
          </div>
        )}
      </div>

      {nets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm text-center flex flex-col gap-3">
            {!set ? (
              <p className="text-text-muted">Connecting…</p>
            ) : info.membership?.status === "active" || op ? (
              <p className="text-text-muted">Connecting to your rooms…</p>
            ) : info.membership?.status === "pending" ? (
              <>
                <h1 className="title text-gold">Waiting for approval</h1>
                <p className="text-text-muted">
                  A leader or officer of {info.membership.name} {t("has to approve you. You will land in the clan lounge as soon as they do.")}
                </p>
              </>
            ) : info.alliance === null ? (
              <>
                <h1 className="title text-gold">{t("Join an alliance")}</h1>
                <p className="text-text-muted">{t("Voice follows your clan. Come in with an invite link from your clan's leader, or start an alliance of your own.")}</p>
                <div><button type="button" className="btn" onClick={() => go("clan")}>Get started</button></div>
              </>
            ) : (
              <>
                <h1 className="title text-gold">{t("Join your clan")}</h1>
                <p className="text-text-muted">{t("Voice follows your clan. Pick yours, get approved, and you are in its lounge.")}</p>
                <div><button type="button" className="btn" onClick={() => go("clan")}>{t("Choose a clan")}</button></div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <div className="flex w-72 shrink-0 flex-col gap-2 min-h-0">
          <ul className="flex shrink-0 flex-col gap-2 overflow-y-auto max-h-[60%]" aria-label="Your nets">
            {nets.map((n) => (
              <NetCard
                key={n.room}
                net={n}
                shown={shown?.room === n.room}
                onShow={() => setShownRoom(n.room === home?.room ? null : n.room)}
                talkHere={!between(n.net) || n.room === loungeRoom}
                onTalkHere={between(n.net) && lounges.length > 1 ? () => engine.setLoungeRoom(n.room) : undefined}
              />
            ))}
          </ul>
          {/* Between operations: who in the alliance has the app open, and the away switch. */}
          {!op && <OnlinePanel />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
          <section className="panel flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4 overflow-y-auto">
            {shown && (
              <>
                <div className="flex flex-wrap items-baseline gap-3">
                  <h1 className={`title ${NET_TEXT[shown.net]}`}>{shown.label}</h1>
                  <span className="text-text-muted">
                    {shown.members.length} connected
                    {shown.members.some((m) => !m.canSpeak) && ` · ${shown.members.filter((m) => m.canSpeak).length} can speak`}
                  </span>
                  <Help text={"Everyone connected to this net. A green outline means that player is speaking.\n\"listening\" marks players who can hear this net but not speak on it.\nClick another player to set your own volume for them, or mute them. Only you are affected."} />
                  {shown.room !== home?.room && (
                    <button type="button" className="ml-auto text-text-muted hover:text-gold cursor-pointer" onClick={() => setShownRoom(null)}>
                      Back to {home?.label ?? "your net"}
                    </button>
                  )}
                </div>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] items-start gap-2">
                  {shown.members.map((m) => (
                    <MemberCard
                      key={m.identity}
                      m={m}
                      colour={shown.net === "lounge" ? "text-net-party" : NET_TEXT[shown.net]}
                      open={openMember === m.identity}
                      onToggle={() => setOpenMember(openMember === m.identity ? null : m.identity)}
                    />
                  ))}
                </ul>
                {shown.net === "reserve" && shown.room === home?.room && <p className="text-text-muted">{t("You are in Reserve until an organiser places you in a party.")}</p>}
                {shown.net === "lounge" && shown.members.length <= 1 && shown.state === "connected" && (
                  <p className="text-text-muted">{t("Nobody else is here yet. Anyone from the clan who opens the app lands in this room.")}</p>
                )}
                <p className="mt-auto pt-2 text-xs text-text-muted">Click a net to see who is on it. Click a player to set your own volume for them.</p>
              </>
            )}
          </section>
          {/* Between operations: the alliance's groups, to start, join or leave one. */}
          {!op && <GroupsPanel />}
          {/* The operation's text chat: the same lines the chat window shows over the game. */}
          {(op || chatView.between) && chatView.channels.length > 0 && (
            <section className={`panel flex ${op ? "h-64" : "h-56"} shrink-0 flex-col`} aria-label="Chat" data-chat-panel>
              <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                <h2 className="title text-sm text-gold">Chat</h2>
                <Help text={op ? t(CHAT_HELP) : t(LOUNGE_CHAT_HELP)} />
                {isDesktop && (
                  <button type="button" className="ml-auto cursor-pointer text-xs text-text-muted hover:text-gold" onClick={openChatWindow} data-chat-window>
                    Open as a window over the game
                  </button>
                )}
              </div>
              <ChatPanel view={chatView} act={chat} />
            </section>
          )}
          </div>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-bg-1/85 px-4 py-2 text-xs text-text-muted">
        {hints.length === 0 && s.bindings.muteAll === null && s.bindings.deafen === null && <span>{idleHint}</span>}
        {hints.map((t) => (
          <span key={t}>
            <kbd className="kbd">{keyLabel(s.bindings[t] as number)}</kbd>{" "}
            <span className={NET_TEXT[t]}>{t === "party" && !op ? "Lounge" : netName(t)}</span>
          </span>
        ))}
        {s.bindings.muteAll !== null && (
          <span>
            <kbd className="kbd">{keyLabel(s.bindings.muteAll)}</kbd> Mute all
          </span>
        )}
        {s.bindings.deafen !== null && (
          <span>
            <kbd className="kbd">{keyLabel(s.bindings.deafen)}</kbd> Headset
          </span>
        )}
        {(hints.length > 0 || s.bindings.muteAll !== null || s.bindings.deafen !== null) && (
          <Help text={"Your keys. Hold a net's key to speak on it; the game still receives the key.\nMute all: press once to silence your mic on every net, press again to restore it.\nHeadset: press once to hear no one (your mic goes off too), again to hear everyone."} />
        )}
        {!isDesktop && <span className="ml-auto">Browser mode: keys only work while this tab has focus.</span>}
      </footer>
    </div>
  );
}
