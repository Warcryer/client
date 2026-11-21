// The one line for everything that waits for the player's answer (server
// decision 65): a request to join their party, an operation asking whether
// they are coming, a new version, the question which class they play, a net
// they may speak on with no key bound, and for a few seconds the news that
// they were moved. Each of these used to be a bar of its own across the
// screen, and three of them took a quarter of the window from the room they
// were shown above. Now the most pressing one is on the line and the others
// are a click away behind a count. What cannot wait (Broadcast locked open, a
// party that lost its leader, a microphone that failed) keeps a bar of its own.

import { useEffect, useState, type ReactNode } from "react";
import { rpc, type JoinRequest } from "../api";
import { useGame } from "../game";
import { bindTargetOf, useSettings, type NetKind } from "../settings";
import { installUpdate, type useUpdate } from "../update";
import { t } from "../words";
import { useAct, useApp } from "./app-context";
import { CharacterFields } from "./CharacterFields";
import { KeyBind, netName, NET_TEXT, useEngine } from "./common";
import { when } from "./RosterView";
import { SignupControl } from "./Signup";

const TALK = new Set(["party", "reserve", "lounge", "group"]);

/** One thing that waits: what it says, and what can be done about it. Normally one line; a form may make it taller while open. */
function Row({ children, tone = "ask", mark, wrap = false }: { children: ReactNode; tone?: "ask" | "news"; mark?: string; /** A form is open in it: it may take the lines it needs. */ wrap?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-x-3 gap-y-2 ${wrap ? "flex-wrap" : ""}`} role="status" data-notice={mark}>
      <span className={`h-1.5 w-1.5 shrink-0 rotate-45 ${tone === "news" ? "bg-gold-bright" : "bg-gold"}`} aria-hidden />
      {children}
    </div>
  );
}

function JoinAsk({ r }: { r: JoinRequest }) {
  const { refreshInfo } = useApp();
  const act = useAct();
  const answer = (accept: boolean) => void act.run(() => rpc("party.answerJoin", { opId: r.opId, partyId: r.partyId, userId: r.userId, accept })).then(refreshInfo);
  return (
    <Row mark="join">
      <span className="min-w-0 truncate">
        <span className="font-semibold">{r.name}</span>
        {r.classTag && <span className="ml-1 text-xs text-gold">{r.classTag}</span>} asks to join <span className="font-semibold text-net-party">{r.partyName}</span>
      </span>
      <span className="flex shrink-0 gap-2">
        <button type="button" className="btn px-3 py-0.5 text-sm" disabled={act.busy} onClick={() => answer(true)}>Accept</button>
        <button type="button" className="btn btn-quiet px-3 py-0.5 text-sm" disabled={act.busy} onClick={() => answer(false)}>Decline</button>
      </span>
      {act.error && <span className="text-danger" role="alert">{act.error}</span>}
    </Row>
  );
}

function ClassAsk({ onLater }: { onLater: () => void }) {
  const { info, refreshInfo } = useApp();
  const game = useGame();
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [cls, setCls] = useState("");
  const [band, setBand] = useState(info.user.levelBand ?? "");
  if (!game) return null;
  return (
    <div className="flex min-w-0 flex-1" data-class-ask>
      <Row mark="class" wrap={open}>
        <span className="min-w-0 truncate">
          Which class do you play?
          <span className="ml-2 text-text-muted">{t("Organisers see it when they build parties, and the board works out from it what each party still needs.")}</span>
        </span>
        {open ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act.run(() => rpc("profile.save", { name: info.user.name, className: cls, levelBand: band }))) refreshInfo();
            }}
          >
            <CharacterFields game={game} className={cls} levelBand={band} onClass={setCls} onLevel={setBand} />
            <button className="btn px-3 py-0.5 text-sm" disabled={act.busy || !cls}>Save</button>
            {act.error && <span className="text-danger" role="alert">{act.error}</span>}
          </form>
        ) : (
          <button type="button" className="btn shrink-0 px-3 py-0.5 text-sm" onClick={() => setOpen(true)}>Choose class</button>
        )}
        <button type="button" className="btn btn-quiet shrink-0 px-3 py-0.5 text-sm" onClick={onLater}>Later</button>
      </Row>
    </div>
  );
}

export function Notices({ update }: { update: ReturnType<typeof useUpdate> }) {
  const { info, set, notice, go } = useApp();
  const game = useGame();
  const eng = useEngine();
  const s = useSettings();
  /** The class question was put off: not asked again until the app is started again. */
  const [later, setLater] = useState(false);
  const [open, setOpen] = useState(false);

  const items: { key: string; node: ReactNode }[] = [];

  // News first: it is gone again in a few seconds.
  if (notice) items.push({ key: "moved", node: <Row tone="news" mark="moved"><span className="min-w-0 truncate text-gold-bright">{notice}</span></Row> });

  for (const r of info.joinRequests) items.push({ key: `join-${r.opId}-${r.userId}`, node: <JoinAsk r={r} /> });

  if (update.phase === "ready" || update.phase === "installing") {
    items.push({
      key: "update",
      node: (
        <Row mark="update">
          <span className="min-w-0 truncate">
            Version {update.version} is ready.
            <span className="ml-2 text-text-muted">
              {update.phase === "installing" ? "Installing; the app will restart by itself." : "Restarting takes a few seconds and drops you from voice while it does."}
            </span>
          </span>
          <button type="button" className="btn shrink-0 px-3 py-0.5 text-sm" disabled={update.phase === "installing"} onClick={() => void installUpdate()}>
            Restart to update
          </button>
        </Row>
      ),
    });
  }

  // Not for the live operation whose nets the player is on: they are there, which is the answer.
  const here = set?.operation?.state === "live" ? set.operation.id : null;
  for (const o of (info.openSignups ?? []).filter((o) => o.opId !== here)) {
    items.push({
      key: `signup-${o.opId}`,
      node: (
        <Row mark="signup">
          <span className="min-w-0 truncate">
            {/* Its name opens its board, as Open does: it is what a player clicks first. */}
            <button type="button" className="cursor-pointer font-semibold text-gold-bright hover:underline" onClick={() => go("roster", o.opId)}>{o.name}</button>
            <span className="text-text-muted"> · {o.state === "live" ? "live now" : when(o.startsAt)} · are you coming?</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <SignupControl opId={o.opId} status={null} />
            <button type="button" className="btn btn-quiet px-3 py-0.5 text-sm" onClick={() => go("roster", o.opId)}>Open</button>
          </span>
        </Row>
      ),
    });
  }

  if (!later && info.alliance && game && game.classes.length > 0 && !info.user.className) items.push({ key: "class", node: <ClassAsk onLater={() => setLater(true)} /> });

  // Nets the player may speak on with no key for them yet: a new leader is prompted to bind theirs.
  const voiceMode = s.partyMode === "voice";
  const op = set?.operation ?? null;
  const unbound = [...new Set(eng.view().filter((n) => n.speak && s.bindings[bindTargetOf(n.net)] === null && !(voiceMode && TALK.has(n.net))).map((n) => bindTargetOf(n.net)))];
  if (unbound.length > 0) {
    items.push({
      key: "keys",
      node: (
        <Row mark="keys" wrap>
          <span className="shrink-0">You can speak here. Bind a key for each:</span>
          {unbound.map((target) => (
            <span key={target} className="inline-flex shrink-0 items-center gap-2">
              <span className={`font-semibold ${NET_TEXT[target as NetKind]}`}>{target === "party" && !op ? "Lounge" : netName(target as NetKind)}</span>
              <KeyBind target={target} label={netName(target as NetKind)} />
            </span>
          ))}
        </Row>
      ),
    });
  }

  const more = items.length - 1;
  useEffect(() => {
    if (more <= 0) setOpen(false);
  }, [more]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div className="relative z-20 shrink-0 border-b border-line bg-bg-2" data-notices={items.length}>
      <div className="flex min-h-10 items-center gap-3 px-4 py-1.5">
        {items[0].node}
        {more > 0 && (
          <button
            type="button"
            className={`ml-auto shrink-0 cursor-pointer whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs ${open ? "border-gold text-gold-bright" : "border-gold-dim text-gold hover:border-gold"}`}
            aria-expanded={open}
            aria-label={`${more} more waiting for you`}
            onClick={() => setOpen(!open)}
            data-notices-more
          >
            {more} more {open ? "▲" : "▼"}
          </button>
        )}
      </div>
      {open && more > 0 && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close the list" tabIndex={-1} onClick={() => setOpen(false)} />
          <ul className="absolute inset-x-0 top-full z-20 flex max-h-[60vh] flex-col divide-y divide-line overflow-y-auto border-b border-gold-dim bg-bg-1 shadow-[0_12px_24px_rgb(0_0_0/0.6)]" data-notices-list>
            {items.slice(1).map((it) => (
              <li key={it.key} className="flex items-center px-4 py-2">{it.node}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
