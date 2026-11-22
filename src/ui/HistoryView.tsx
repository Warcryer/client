// Attendance over time. For an alliance's admins and a clan's leader and
// officers: turnout from one operation to the next, and how often each player
// comes. For every player: their own record. The server keeps a row per
// player per operation, written as each operation ends, and works these out.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rpc } from "../api";
import { d, t } from "../words";
import { dayFull as fullDay, dayShort as day, span } from "./common";
import { useApp } from "./app-context";
import { Help } from "./tips";
import { POINTS_HELP, PointsStandings, poolTitle, usePointsOverview } from "./Points";
import { LOOT_HELP, LootHistory } from "./Loot";

type TurnoutOp = { id: number; name: string; eventType: string | null; endedAt: string; seconds: number; expected: number; attended: number; coming: number; noShow: number };
type Totals = { expected: number; attended: number; noShow: number; share: number; lastAt: string | null };
type TurnoutPlayer = Totals & { userId: number; name: string; clanTag: string | null };
type Turnout = { clans: { id: number; name: string; tag: string }[]; all: boolean; clanId: number | null; days: number; operations: TurnoutOp[]; players: TurnoutPlayer[] };
type PlayerRecord = {
  player: { userId: number; name: string; clanTag: string | null };
  days: number;
  totals: Totals;
  operations: { id: number; name: string; eventType: string | null; endedAt: string; seconds: number; attendedSeconds: number; signup: "coming" | "out" | null; party: string | null; cameAs: string; className: string | null; clanTag: string | null }[];
};

// Labels: t() where shown.
const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "3 months" },
  { days: 365, label: "A year" },
  { days: 0, label: "Everything" },
];

// t() where shown.
const HELP = [
  "When an operation ends, who was in voice and for how long is written down for every member of the clans that took part. This screen reads those records.",
  "Expected: the members of the clans in the operation when it ended. In voice: those of them who were in voice at any time while it ran.",
  "Did not show: said they were coming and were never in voice.",
  "Time stayed: of the time the operations a player came to ran, the share they were in voice.",
  "An alliance's admins see everyone. A clan's leader and officers see their own clan. Every player sees their own record.",
].join("\n");

/** The chart's two fills: a step of the app's gold that holds up on its dark surface, and a dim step of the same hue for the rest of the column. */
const FILL = "#b68d35";
const TRACK = "#3a3222";

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function Tile({ id, label, value, note }: { id: string; label: string; value: string; note?: string }) {
  return (
    <div className="min-w-32 flex-1 rounded-sm border border-line bg-bg-1 px-4 py-3" data-history-tile={id}>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-2xl font-semibold text-text">{value}</div>
      {note && <div className="text-xs text-text-muted">{note}</div>}
    </div>
  );
}

/** A thin bar for one ratio in a row of a list. */
function Meter({ part, whole }: { part: number; whole: number }) {
  return (
    <span className="inline-block h-2 w-24 overflow-hidden rounded-full align-middle" style={{ background: TRACK }} aria-hidden>
      <span className="block h-full rounded-full" style={{ width: `${whole > 0 ? Math.min(100, (part / whole) * 100) : 0}%`, background: FILL }} />
    </span>
  );
}

/** A column with a rounded top and a square foot. */
const column = (x: number, y: number, w: number, h: number, r: number) => {
  const c = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + c}Q${x},${y} ${x + c},${y}H${x + w - c}Q${x + w},${y} ${x + w},${y + c}V${y + h}Z`;
};

/**
 * Turnout by operation: a column for each, as tall as the players expected, filled as far as those who
 * were in voice. Oldest on the left. Pointing at a column, or tabbing to it, says the rest.
 */
function TurnoutChart({ ops }: { ops: TurnoutOp[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [at, setAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setWidth(Math.max(280, el.clientWidth));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const H = 190, TOP = 12, BOTTOM = 26, LEFT = 34, RIGHT = 8;
  // Each operation has a slot; the column in it is never wider than 24. With many operations the chart scrolls sideways.
  const slot = Math.max(16, Math.min(56, (width - LEFT - RIGHT) / Math.max(1, ops.length)));
  const w = Math.max(width, LEFT + RIGHT + slot * ops.length);
  const bar = Math.min(24, slot - 6);
  const most = Math.max(1, ...ops.map((o) => o.expected));
  // A scale that ends on a round number, with a line at its half.
  const step = most <= 4 ? 1 : most <= 10 ? 2 : most <= 20 ? 5 : most <= 50 ? 10 : most <= 100 ? 25 : most <= 200 ? 50 : 100;
  const top = Math.ceil(most / step) * step;
  const ticks = top / step <= 4 ? Array.from({ length: top / step + 1 }, (_, i) => i * step) : [0, top / 2, top];
  const y = (n: number) => TOP + (H - TOP - BOTTOM) * (1 - n / top);
  const foot = y(0);
  // Dates under the columns, as many as fit side by side.
  const every = Math.max(1, Math.ceil(52 / slot));
  const shown = at === null ? null : ops[at];
  const tipLeft = at === null ? 0 : Math.min(Math.max(LEFT + slot * at + slot / 2, 110), w - 110);

  return (
    <div className="flex flex-col gap-2" data-history-chart>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: FILL }} />{t("In voice")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: TRACK }} />{t("Expected and not there")}</span>
      </div>
      <div ref={box} className="relative overflow-x-auto" onPointerLeave={() => setAt(null)}>
        <svg width={w} height={H} role="group" aria-label={t("Turnout by operation, oldest first")} className="block">
          {ticks.map((n) => (
            <g key={n}>
              <line x1={LEFT} x2={w - RIGHT} y1={y(n)} y2={y(n)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={LEFT - 8} y={y(n) + 4} textAnchor="end" fontSize={11} fill="var(--color-text-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{n}</text>
            </g>
          ))}
          {ops.map((o, i) => {
            const x = LEFT + slot * i + (slot - bar) / 2;
            const missing = o.expected - o.attended;
            const yIn = y(o.attended), yAll = y(o.expected);
            // Two pixels of the surface between the two parts of a column, taken from the upper one.
            const gap = o.attended > 0 && missing > 0 ? 2 : 0;
            return (
              <g
                key={o.id}
                tabIndex={0}
                role="img"
                aria-label={t(`${d(o.name)}, ${d(fullDay(o.endedAt))}: ${d(o.attended)} of ${d(o.expected)} in voice; ${d(o.coming)} said they were coming, ${d(o.noShow)} of them did not show`)}
                onPointerEnter={() => setAt(i)}
                onFocus={() => setAt(i)}
                onBlur={() => setAt(null)}
                className="outline-none"
                data-history-bar={o.id}
              >
                <rect x={LEFT + slot * i} y={TOP} width={slot} height={H - TOP - BOTTOM} fill={at === i ? "rgb(255 255 255 / .04)" : "transparent"} />
                {missing > 0 && yIn - gap - yAll > 0 && <path d={column(x, yAll, bar, (o.attended > 0 ? yIn - gap : foot) - yAll, 4)} fill={TRACK} />}
                {o.attended > 0 && <path d={column(x, yIn, bar, foot - yIn, missing > 0 ? 0 : 4)} fill={FILL} opacity={at === null || at === i ? 1 : 0.75} />}
                {i % every === 0 && (
                  <text x={LEFT + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)">{day(o.endedAt)}</text>
                )}
              </g>
            );
          })}
          <line x1={LEFT} x2={w - RIGHT} y1={foot} y2={foot} stroke="var(--color-gold-dim)" strokeWidth={1} />
        </svg>
        {shown && (
          <div className="pointer-events-none absolute top-1 z-10 w-52 -translate-x-1/2 rounded-sm border border-gold-dim bg-bg-0 px-3 py-2 text-xs shadow-lg" style={{ left: tipLeft }} role="status" data-history-tip>
            <div className="text-sm font-semibold text-text">{t(`${d(shown.attended)} of ${d(shown.expected)} in voice`)}</div>
            <div className="truncate text-text-muted">{shown.name}</div>
            <div className="text-text-muted">{fullDay(shown.endedAt)} · {t(`ran ${d(span(shown.seconds))}`)}</div>
            <div className="mt-1 text-text-muted">{t(`${d(shown.coming)} said they were coming`)}{shown.noShow > 0 ? ` · ${t(`${d(shown.noShow)} did not show`)}` : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function OperationsTable({ ops }: { ops: TurnoutOp[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-history-table>
        <thead>
          <tr className="text-left text-xs text-text-muted">
            <th className="py-1 pr-3 font-normal">{t("Ended")}</th>
            <th className="py-1 pr-3 font-normal">{t("Operation")}</th>
            <th className="py-1 pr-3 text-right font-normal">{t("In voice")}</th>
            <th className="py-1 pr-3 text-right font-normal">{t("Expected")}</th>
            <th className="py-1 pr-3 text-right font-normal">{t("Said coming")}</th>
            <th className="py-1 pr-3 text-right font-normal">{t("Did not show")}</th>
            <th className="py-1 text-right font-normal">{t("Ran")}</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {[...ops].reverse().map((o) => (
            <tr key={o.id} className="border-t border-line">
              <td className="py-1 pr-3 text-text-muted">{fullDay(o.endedAt)}</td>
              <td className="py-1 pr-3">{o.name}</td>
              <td className="py-1 pr-3 text-right">{o.attended}</td>
              <td className="py-1 pr-3 text-right">{o.expected}</td>
              <td className="py-1 pr-3 text-right">{o.coming}</td>
              <td className="py-1 pr-3 text-right">{o.noShow}</td>
              <td className="py-1 text-right text-text-muted">{span(o.seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One player's record: what they came to, newest first. */
function Record({ userId, days, onBack }: { userId: number; days: number; onBack?: () => void }) {
  const { tick } = useApp();
  const [data, setData] = useState<PlayerRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    rpc<PlayerRecord>("history.player", { userId, days })
      .then((r) => live && (setData(r), setError("")))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [userId, days, tick]);
  if (error) return <p className="text-danger" role="alert">{error}</p>;
  if (!data) return <p className="text-text-muted">{t("Loading…")}</p>;
  const { totals } = data;
  return (
    <section className="panel flex flex-col gap-4 p-5" data-history-record={data.player.userId}>
      <h2 className="title title-rule text-sm text-gold">
        {data.player.name}
        {data.player.clanTag && <span className="text-xs font-normal text-text-muted"> [{data.player.clanTag}]</span>}
      </h2>
      {onBack && (
        <button type="button" className="btn btn-quiet self-start text-xs" onClick={onBack}>{t("Back to everyone")}</button>
      )}
      <div className="flex flex-wrap gap-3">
        <Tile id="attended" label={t("Operations attended")} value={`${totals.attended} of ${totals.expected}`} note={totals.expected > 0 ? `${pct(totals.attended, totals.expected)}%` : undefined} />
        <Tile id="noshow" label={t("Said coming, did not show")} value={String(totals.noShow)} />
        <Tile id="share" label={t("Time stayed")} value={totals.attended > 0 ? `${Math.round(totals.share * 100)}%` : "–"} note={totals.lastAt ? t(`Last there ${d(fullDay(totals.lastAt))}`) : undefined} />
      </div>
      {data.operations.length === 0 ? (
        <p className="text-text-muted">{t("No operation in this period that their clan took part in.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="py-1 pr-3 font-normal">{t("Ended")}</th>
                <th className="py-1 pr-3 font-normal">{t("Operation")}</th>
                <th className="py-1 pr-3 font-normal">{t("In voice")}</th>
                <th className="py-1 pr-3 font-normal">{t("Answered")}</th>
                <th className="py-1 pr-3 font-normal">{t("Party")}</th>
                <th className="py-1 font-normal">{t("Came as")}</th>
              </tr>
            </thead>
            <tbody>
              {data.operations.map((o) => (
                <tr key={o.id} className="border-t border-line" data-history-op={o.id}>
                  <td className="py-1 pr-3 text-text-muted">{fullDay(o.endedAt)}</td>
                  <td className="py-1 pr-3">{o.name}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    <Meter part={o.attendedSeconds} whole={Math.max(o.seconds, o.attendedSeconds)} />
                    <span className={`ml-2 tabular-nums ${o.attendedSeconds > 0 ? "" : "text-text-muted"}`}>{o.attendedSeconds > 0 ? `${span(o.attendedSeconds)} of ${span(o.seconds)}` : t("Not there")}</span>
                  </td>
                  <td className="py-1 pr-3 text-text-muted">{o.signup === "coming" ? t("Coming") : o.signup === "out" ? t("Can't come") : t("No answer")}</td>
                  <td className="py-1 pr-3 text-text-muted">{o.party ?? ""}</td>
                  <td className="py-1 text-text-muted">{o.cameAs}{o.className ? ` · ${o.className}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AttendanceHistory({ tabs }: { tabs: React.ReactNode }) {
  const { info, tick } = useApp();
  const role = info.membership?.status === "active" ? info.membership.role : null;
  const leads = info.user.runsAlliance || role === "leader" || role === "officer";
  const [days, setDays] = useState(90);
  const [clanId, setClanId] = useState<number | null>(null);
  const [data, setData] = useState<Turnout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [player, setPlayer] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!leads) return;
    let live = true;
    setLoading(true);
    rpc<Turnout>("history.turnout", { days, clanId })
      .then((r) => live && (setData(r), setError("")))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [leads, days, clanId, tick]);

  const filters = (
    <div className="flex flex-wrap items-center gap-2" data-history-filters>
      <div className="flex gap-1" role="group" aria-label={t("Period")}>
        {PERIODS.map((p) => (
          <button key={p.days} type="button" className={`btn text-xs ${days === p.days ? "" : "btn-quiet"}`} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>
            {p.label}
          </button>
        ))}
      </div>
      {leads && data && (data.all || data.clans.length > 1) && (
        <select className="field w-auto" value={data.clanId ?? ""} aria-label={t("Clan")} onChange={(e) => setClanId(e.target.value === "" ? null : Number(e.target.value))}>
          {data.all && <option value="">{t("The whole alliance")}</option>}
          {data.clans.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {leads && (
        <button type="button" className="btn btn-quiet ml-auto text-xs" onClick={() => setPlayer(player === info.user.id ? null : info.user.id)} aria-pressed={player === info.user.id}>
          {t("My own record")}
        </button>
      )}
    </div>
  );

  // A player without a clan to lead sees their own record, and nothing else.
  if (!leads) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4" data-history="own">
        <h1 className="title flex items-center gap-2 text-gold-bright">{t("History")} <Help text={t(HELP)} /></h1>
        {tabs}
        {filters}
        <Record userId={info.user.id} days={days} />
      </div>
    );
  }

  const ops = data?.operations ?? [];
  const expected = ops.reduce((n, o) => n + o.expected, 0);
  const attended = ops.reduce((n, o) => n + o.attended, 0);
  const noShow = ops.reduce((n, o) => n + o.noShow, 0);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4" data-history="turnout">
      <h1 className="title flex items-center gap-2 text-gold-bright">{t("History")} <Help text={t(HELP)} /></h1>
      {tabs}
      {filters}
      {error && <p className="text-danger" role="alert">{error}</p>}
      {player !== null ? (
        <Record userId={player} days={days} onBack={() => setPlayer(null)} />
      ) : !data ? (
        <p className="text-text-muted">{t("Loading…")}</p>
      ) : ops.length === 0 ? (
        <section className="panel p-5 text-text-muted" data-history-empty>
          {t("No operation ended in this period. When one ends, who was in voice is written down and shows here.")}
        </section>
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap gap-3">
            <Tile id="operations" label={t("Operations")} value={String(ops.length)} />
            <Tile id="turnout" label={t("Average turnout")} value={`${pct(attended, expected)}%`} note={t(`On average ${d(Math.round(attended / ops.length))} of ${d(Math.round(expected / ops.length))} in voice`)} />
            <Tile id="noshow" label={t("Said coming, did not show")} value={String(noShow)} />
            <Tile id="players" label={t("Players")} value={String(data.players.length)} />
          </div>
          <section className="panel flex flex-col gap-3 p-5">
            <h2 className="title title-rule text-sm text-gold">{t("Turnout by operation")}</h2>
            <TurnoutChart ops={ops} />
            <button type="button" className="btn btn-quiet self-start text-xs" aria-expanded={table} onClick={() => setTable(!table)}>
              {table ? t("Hide the table") : t("Show as a table")}
            </button>
            {table && <OperationsTable ops={ops} />}
          </section>
          <section className="panel flex flex-col gap-3 p-5">
            <h2 className="title title-rule text-sm text-gold">{t("Players")}</h2>
            <p className="text-xs text-text-muted">{t("Those who come least often first. Click a player for their record.")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-history-players>
                <thead>
                  <tr className="text-left text-xs text-text-muted">
                    <th className="py-1 pr-3 font-normal">{t("Player")}</th>
                    <th className="py-1 pr-3 font-normal">{t("Operations attended")}</th>
                    <th className="py-1 pr-3 text-right font-normal">{t("Did not show")}</th>
                    <th className="py-1 pr-3 text-right font-normal">{t("Time stayed")}</th>
                    <th className="py-1 font-normal">{t("Last there")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.players.map((p) => (
                    <tr key={p.userId} className="cursor-pointer border-t border-line hover:bg-bg-2" onClick={() => setPlayer(p.userId)} data-history-player={p.userId}>
                      <td className="py-1 pr-3">
                        <button type="button" className="cursor-pointer text-left text-gold hover:text-gold-bright" onClick={() => setPlayer(p.userId)}>{p.name}</button>
                        {p.clanTag && <span className="text-[11px] text-text-muted"> [{p.clanTag}]</span>}
                      </td>
                      <td className="py-1 pr-3 whitespace-nowrap">
                        <Meter part={p.attended} whole={p.expected} />
                        <span className="ml-2 tabular-nums">{t(`${d(p.attended)} of ${d(p.expected)}`)}</span>
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{p.noShow > 0 ? p.noShow : ""}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-text-muted">{p.attended > 0 ? `${Math.round(p.share * 100)}%` : ""}</td>
                      <td className="py-1 text-text-muted">{p.lastAt ? fullDay(p.lastAt) : t("Never")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * The History tab: attendance over time, the loot history and, when the
 * alliance or the player's clan keeps points, a tab for each of those.
 */
export function HistoryView() {
  const [points] = usePointsOverview();
  const [view, setView] = useState<number | "loot" | null>(null);
  const pools = (points?.pools ?? []).filter((p) => p.settings.enabled && p.id !== null);
  const tabs = (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("What to show")} data-history-tabs>
      <button type="button" role="tab" aria-selected={view === null} className={`btn text-sm ${view === null ? "" : "btn-quiet"}`} onClick={() => setView(null)}>
        {t("Attendance")}
      </button>
      {pools.map((p, i) => (
        <button key={p.id} type="button" role="tab" aria-selected={view === i} className={`btn text-sm ${view === i ? "" : "btn-quiet"}`} onClick={() => setView(i)} data-history-tab-points={p.id}>
          {poolTitle(p)}
        </button>
      ))}
      <button type="button" role="tab" aria-selected={view === "loot"} className={`btn text-sm ${view === "loot" ? "" : "btn-quiet"}`} onClick={() => setView("loot")} data-history-tab-loot>
        {t("Loot")}
      </button>
    </div>
  );
  if (view === "loot") {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4" data-history="loot">
        <h1 className="title flex items-center gap-2 text-gold-bright">{t("History")} <Help text={t(LOOT_HELP)} /></h1>
        {tabs}
        <LootHistory />
      </div>
    );
  }
  const pool = view === null ? undefined : pools[view];
  if (!pool) return <AttendanceHistory tabs={tabs} />;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4" data-history="points">
      <h1 className="title flex items-center gap-2 text-gold-bright">{t("History")} <Help text={t(POINTS_HELP)} /></h1>
      {tabs}
      <PointsStandings key={pool.id} pool={pool} />
    </div>
  );
}
