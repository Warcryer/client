// The right-hand side of the Voice screen during an operation (server
// decision 65): the operation itself. What it is called and whether it is
// live, the way to its roster board, where the player is (to sit it out or
// form up early), and its parties at a glance: who leads each and how full it
// is, the player's own marked. The board is where a roster is worked on; this
// is for seeing where everyone stands without leaving the Voice screen.

import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../api";
import { partySizeOf, useGame } from "../game";
import { d, t } from "../words";
import { useApp } from "./app-context";
import { Help } from "./tips";
import { TargetsButton } from "./Targets";

type Who = { id: number; name: string; classTag: string | null };
/** An operation's parties for looking at (`op.glance`): far less than the board's `op.get`, which is asked for by a few. */
type Glance = { opId: number; parties: { id: number; name: string; leaderId: number | null; leaderLost: boolean; members: Who[] }[] };

/** Other players' moves are shown no sooner than this after the last look: a roster being built changes every second. */
const GAP_MS = 20_000;

/**
 * The operation's parties, for looking at. Fetched when the panel opens and within a second or so of the
 * player's own place changing; for everyone else's moves at most every twenty seconds, at a random moment, and only
 * while the window is in sight. Hundreds of players have this panel open during an operation: all of them
 * asking on every roster move would be the stampede decision 26 removed, and the board's own `op.get`
 * takes some 75 ms with 350 players. A server before 0.37 has no `op.glance`: then there is no list.
 */
function useGlance(opId: number, place: string): Glance | null | "none" {
  const { tick } = useApp();
  const [data, setData] = useState<Glance | null | "none">(null);
  const last = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(() => {
    last.current = Date.now();
    rpc<Glance>("op.glance", { opId })
      .then((d) => setData(d))
      .catch(() => setData((had) => had ?? "none"));
  }, [opId]);
  const latest = useRef(load);
  latest.current = load;
  // Going live moves everyone at the same moment: each app looks at a random moment within a second and a half.
  useEffect(() => {
    const t = window.setTimeout(load, Math.random() * 1500);
    return () => window.clearTimeout(t);
  }, [load, place]);
  useEffect(() => {
    if (tick === 0 || timer.current !== undefined) return;
    timer.current = window.setTimeout(
      () => {
        timer.current = undefined;
        if (document.visibilityState === "visible") latest.current();
      },
      Math.max(0, last.current + GAP_MS - Date.now()) + Math.random() * 3000,
    );
  }, [tick]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return data === "none" ? "none" : data && data.opId === opId ? data : null;
}

/** Where the player is: the lounge, or one of the operations they are on the roster of. */
export function WherePicker() {
  const { set, select } = useApp();
  if (!set || set.operations.length === 0) return null;
  const op = set.operation;
  const hasLive = set.operations.some((o) => o.state === "live");
  return (
    <div className="flex items-center gap-2 text-sm" data-where>
      <span className="shrink-0 text-text-muted">{t("You are in")}</span>
      <select
        className="field min-w-0 flex-1 py-1"
        value={op ? String(op.id) : "lounge"}
        aria-label={t("Where you are")}
        onChange={(e) => {
          // Picking the lounge during a live operation is a deliberate choice to sit it out.
          if (e.target.value === "lounge") select(hasLive ? "lounge" : "auto");
          else select(Number(e.target.value));
        }}
      >
        <option value="lounge">{t("Lounge")}</option>
        {set.operations.map((o) => (
          <option key={o.id} value={o.id}>{o.name} ({o.state === "live" ? t("live") : t("planned")})</option>
        ))}
      </select>
      <Help text={t("Between operations you are in your clan's lounge. A live operation pulls you onto its nets by itself and returns you when it ends.\nPick the lounge to sit an operation out, or a planned operation to form up early.")} />
    </div>
  );
}

// t() where shown.
const PARTIES_HELP = [
  "The operation's parties as they stand: who leads each and how many are in it. Yours is marked. Click a party to see its players.",
  "Players no organiser has placed yet wait on the Reserve net: click it on the left to see who is there.",
  "Other players' moves show here within about twenty seconds; your own within a second or two. To move anyone, open the roster board.",
].join("\n");

export function OperationPanel() {
  const { set, info, go } = useApp();
  const game = useGame();
  const op = set?.operation ?? null;
  // The player's own party or Reserve room: when it changes, they were moved.
  const place = set?.nets.find((n) => n.net === "party" || n.net === "reserve")?.room ?? "";
  const data = useGlance(op?.id ?? 0, place);
  const [openId, setOpenId] = useState<number | null>(null);
  if (!op) return null;
  const size = partySizeOf(game);
  const me = info.user.id;
  const glance = data === "none" ? null : data;
  const parties = glance?.parties ?? [];
  const placed = parties.reduce((n, p) => n + p.members.length, 0);
  const who = (m: Who) => (
    <li key={m.id} className={`whitespace-nowrap ${m.id === me ? "text-gold-bright" : ""}`}>
      {m.name}
      {m.classTag && <span className="ml-1 text-xs text-gold">{m.classTag}</span>}
    </li>
  );
  return (
    <section className="panel flex min-h-0 flex-1 flex-col" aria-label={t("The operation")} data-op-panel>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <h2 className="title min-w-0 truncate text-sm text-gold">{op.name}</h2>
        <span className={`ml-auto shrink-0 text-xs uppercase tracking-wider ${op.state === "live" ? "text-net-party" : "text-gold"}`} data-op-state>
          {op.state === "live" ? t("Live") : t("Planned")}
        </span>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2">
        <WherePicker />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-quiet min-w-0 flex-1 py-1 text-sm" onClick={() => go("roster", op.id)}>
            {t("Open the roster board")}
          </button>
          {/* The operation's priority targets: the whole list, and for its leaders the way to change it mid-fight. */}
          <TargetsButton opId={op.id} />
        </div>
      </div>
      {data !== "none" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-op-parties>
          <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-line bg-bg-1 px-3 py-1">
            <h3 className="text-xs uppercase tracking-wider text-text-muted">
              {t("Parties")} <span className="tabular-nums">{parties.length}</span>
              {glance && <span className="normal-case tracking-normal"> · {t(`${d(placed)} placed`)}</span>}
            </h3>
            <Help text={t(PARTIES_HELP)} />
          </div>
          {!glance ? (
            <p className="px-3 py-2 text-sm text-text-muted">{t("Loading…")}</p>
          ) : parties.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">{t("No parties yet. They are built on the roster board.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {parties.map((p) => {
                const mine = p.members.some((m) => m.id === me);
                const open = p.id === openId;
                const leader = p.members.find((m) => m.id === p.leaderId)?.name ?? null;
                return (
                  <li key={p.id} className={mine ? "bg-bg-2" : ""} data-op-party={p.id} data-mine={mine ? "" : undefined}>
                    <button type="button" className="flex w-full cursor-pointer flex-col px-3 py-1.5 text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : p.id)}>
                      <span className="flex items-baseline gap-2">
                        <span className={`min-w-0 truncate font-medium ${mine ? "text-net-party" : "text-text"}`}>{p.name}</span>
                        <span className={`ml-auto shrink-0 text-xs tabular-nums ${p.members.length >= size ? "text-text" : "text-text-muted"}`}>
                          {p.members.length}/{size}
                        </span>
                      </span>
                      <span className="truncate text-xs text-text-muted">
                        {leader ? t(`led by ${d(leader)}`) : t("no leader")}
                        {p.leaderLost && <span className="text-danger"> {t("· leader away")}</span>}
                        {mine && <> · {t("yours")}</>}
                      </span>
                    </button>
                    {open && <ul className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 text-sm">{p.members.map(who)}</ul>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
