// Points (an alliance may call them DKP or anything else): the settings of a
// pool, its standings, a player's lines, and an operation's points from its
// draft to being posted. The server decides who may see and do what (its
// web/lib/points.ts, STATUS decisions 57, 60 and 62); these screens offer only that.

import { Fragment, useEffect, useState } from "react";
import { rpc } from "../api";
import { d, own, t } from "../words";
import { tn, tx, when as inLanguage } from "../i18n";
import { useAct, useApp } from "./app-context";
import { Help } from "./tips";

export type RuleKind = "attend" | "hourly" | "onTime" | "toEnd" | "came" | "noShow" | "standby" | "objective";
export type Rule = { kind: RuleKind; amount: number; kinds: string[]; minShare?: number; minutes?: number; label?: string };
type PresetId = "attendance" | "dkp" | "dkpHourly" | "epgp" | "zeroSum" | "suicideKings" | "fleet" | "custom";
type Spending = "none" | "price" | "council" | "epgp" | "zeroSum" | "list";
export type PoolSettings = {
  enabled: boolean;
  name: string;
  preset: PresetId;
  kinds: string[];
  rules: Rule[];
  decay: { pct: number; every: "week" | "month"; floor: number };
  spending: Spending;
  /** EPGP: base gear points, and the EP needed to be first in line (absent from servers before 2b-2). */
  gear?: { baseGp: number; minEp: number };
  limits: { negative: boolean; cap: number };
  eventLeaderPosts: boolean;
  open: boolean;
};
export type PoolInfo = { id: number; clanId: number | null; clanTag: string | null; clanName: string | null; settings: PoolSettings; season: number; seasonAt: string | null; manage: boolean; seeAll: boolean };
type Preset = { id: PresetId; title: string; about: string };
export type PointsOverview = { clanPools: boolean; eventTypes: string[]; presets: Preset[]; canCreate: { alliance: boolean; clans: { id: number; tag: string; name: string }[] }; pools: PoolInfo[] };
type StandingRow = {
  userId: number;
  name: string;
  clanTag: string | null;
  points: number;
  earned: number;
  adjusted: number;
  decayed: number;
  spent?: number;
  /** EPGP (decision 62): gear points, priority, and whether they reach the minimum EP. */
  gp?: number;
  priority?: number | null;
  minReached?: boolean;
  /** Suicide Kings: the place in the list. */
  position?: number | null;
  lastAt: string | null;
};
type WaitingOp = { id: number; name: string; eventType: string | null; endedAt: string };
type Standings = { pool: PoolInfo; rows: StandingRow[]; waiting: WaitingOp[] };
type Entry = { id: number; at: string; kind: "earned" | "adjust" | "decay" | "reset" | "spent" | "refund" | "share"; amount: number; gp?: number; label: string | null; reason: string | null; by: string | null; operationId: number | null };
type PlayerPoints = { pool: PoolInfo; player: { userId: number; name: string }; points: number; gp?: number; entries: Entry[] };
type Part = { what: string; amount: number };
type OpRow = { userId: number; name: string; clanTag: string | null; seconds: number; signup: "coming" | "out" | null; suggested: { amount: number; parts: Part[] }; attended: boolean; amount: number | null; why: string | null };
type OpPool = { pool: PoolInfo; posted: { by: string | null; at: string } | null; canPost: boolean; objectives: { label: string; amount: number }[]; standby: number | null; rows: OpRow[] };
type OpPointsData = { op: { id: number; name: string; eventType: string | null; endedAt: string | null; seconds: number }; pools: OpPool[] };

// t() where shown.
export const POINTS_HELP = [
  "Points (call them DKP, EP, PAP or anything else) are earned at operations and can be spent on loot: by price, by loot council, by EPGP (gear points and priority), Zero-sum (the price shared among the others there) or a Suicide Kings list. An alliance can keep several sets, such as one for raids and one for sieges, and each clan can keep its own if the alliance allows it.",
  "When an operation ends, what each player earned is worked out from who was in voice, when and for how long, as a draft. Whoever posts the points ticks any objectives reached and anyone on standby, changes what needs changing, and posts it. Nothing is added until then.",
  "How points are earned is a list of rules: for being there, per hour, on time, to the end, coming as said, not showing, standby and named objectives. Each rule can be for every kind of event or only some. A preset fills the rules in to start from.",
  "Points can also be given or taken by hand, always with a reason, and can decay by a share each week or month. Nothing is ever changed or removed: a mistake is put right with another line, and every line is in the log.",
  "Each player always sees their own points, every line behind them, and the rules.",
].join("\n");

export const poolTitle = (p: PoolInfo) => (p.clanId === null ? p.settings.name : `${p.settings.name} [${p.clanTag ?? ""}]`);
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const dur = (s: number) => (s >= 3600 ? t(`${d(Math.floor(s / 3600))} h ${d(Math.round((s % 3600) / 60))} min`) : t(`${d(Math.round(s / 60))} min`));
const day = (iso: string) => inLanguage(iso, { day: "numeric", month: "short", year: "numeric" });
const num = (v: string, max = 10000) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
/** The same words the server keeps as a posted line's reason (core/points.ts, partsText). */
const partsText = (parts: Part[]) => parts.map((p) => `${p.what} ${p.amount > 0 ? p.amount : `−${-p.amount}`}`).join(", ");

const EMPTY: PointsOverview = { clanPools: false, eventTypes: [], presets: [], canCreate: { alliance: false, clans: [] }, pools: [] };

/** The points the viewer can see or set up. Null while loading. */
export function usePointsOverview(): [PointsOverview | null, () => void] {
  const { tick } = useApp();
  const [data, setData] = useState<PointsOverview | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    rpc<PointsOverview>("points.overview")
      .then((r) => live && setData({ ...EMPTY, ...r }))
      // A server from before points answers with an unknown method: no points, nothing to show.
      .catch(() => live && setData(EMPTY));
    return () => {
      live = false;
    };
  }, [tick, again]);
  return [data, () => setAgain((n) => n + 1)];
}

// ---- Settings ----

/**
 * The alliance's sets of points (clanId null), for its admins, with the switch
 * that lets clans keep their own; or a clan's, for its leader and officers,
 * once the alliance allows it. One tab per set, and one to add another.
 */
export function PointsSettingsSection({ clanId }: { clanId: number | null }) {
  const [data, reload] = usePointsOverview();
  const [open, setOpen] = useState<number | "new" | null>(null);
  if (!data) return null;
  const pools = data.pools.filter((p) => p.clanId === clanId && p.manage);
  const mayCreate = clanId === null ? data.canCreate.alliance : data.canCreate.clans.some((c) => c.id === clanId);
  if (!mayCreate && pools.length === 0) return null;
  const shown = open === "new" ? null : (pools.find((p) => p.id === open) ?? pools[0] ?? null);
  const adding = open === "new" || (pools.length === 0 && mayCreate);
  return (
    <section className="panel flex flex-col gap-3 p-5" data-points-settings={clanId === null ? "alliance" : clanId}>
      <h2 className="title title-rule text-sm text-gold">
        {clanId === null ? t("Points") : t("The clan's own points")}
        <Help text={t(POINTS_HELP) + (clanId === null ? "\n" + t("The alliance's admins can also let each clan keep points of its own, run by the clan's leader and officers, for the clan's own loot.") : "")} />
      </h2>
      {(pools.length > 0 || mayCreate) && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("Sets of points")}>
          {pools.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={!adding && shown?.id === p.id} className={`btn text-sm ${!adding && shown?.id === p.id ? "" : "btn-quiet"}`} onClick={() => setOpen(p.id)} data-points-pool-tab={p.id}>
              {p.settings.name}
              {!p.settings.enabled && <span className="ml-1 text-xs text-text-muted">{t("(off)")}</span>}
            </button>
          ))}
          {mayCreate && pools.length < 10 && (
            <button type="button" role="tab" aria-selected={adding} className={`btn text-sm ${adding ? "" : "btn-quiet"}`} onClick={() => setOpen("new")} data-points-new>
              {t("+ New set of points")}
            </button>
          )}
        </div>
      )}
      {adding ? (
        <CreatePool clanId={clanId} presets={data.presets} first={pools.length === 0} onCreated={(id) => (setOpen(id), reload())} />
      ) : (
        shown && <PointsForm key={`${shown.id}-${JSON.stringify(shown.settings)}`} pool={shown} eventTypes={data.eventTypes} presets={data.presets} onSaved={reload} onRemoved={() => (setOpen(null), reload())} />
      )}
      {clanId === null && data.canCreate.alliance && <ClanPoolsSwitch on={data.clanPools} onChange={reload} />}
    </section>
  );
}

function CreatePool({ clanId, presets, first, onCreated }: { clanId: number | null; presets: Preset[]; first: boolean; onCreated: (id: number) => void }) {
  const act = useAct();
  const [preset, setPreset] = useState<PresetId>("dkp");
  const about = presets.find((p) => p.id === preset)?.about ?? "";
  const create = () => {
    let made = 0;
    void act.run(async () => (made = (await rpc<{ poolId: number }>("points.createPool", { clanId, preset })).poolId)).then((ok) => ok && onCreated(made));
  };
  return (
    <div className="flex flex-col gap-2" data-points-create>
      {first && <p className="text-sm text-text-muted">{clanId === null ? t("No points yet. Start from the preset closest to how your alliance does it; every part can be changed afterwards.") : t("No points for the clan yet. Start from the preset closest to how the clan does it; every part can be changed afterwards.")}</p>}
      <label className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-text-muted">{t("Start from")}</span>
        <select className="field w-auto" value={preset} onChange={(e) => setPreset(e.target.value as PresetId)} aria-label={t("Preset")} data-points-preset>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-text-muted sm:pl-42" data-points-preset-about>{about}</p>
      <div className="flex items-center gap-3">
        <button type="button" className="btn" disabled={act.busy} onClick={create} data-points-create-go>{t("Set it up")}</button>
        <span className="text-xs text-text-muted">{t("It starts switched off, so you can look it over first.")}</span>
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
      </div>
    </div>
  );
}

function ClanPoolsSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  const act = useAct();
  return (
    <label className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <input type="checkbox" checked={on} disabled={act.busy} data-points-clan-pools onChange={(e) => void act.run(() => rpc("points.setClanPools", { on: e.target.checked })).then(onChange)} />
      {t("Clans may keep points of their own")}
      <span className="text-xs text-text-muted">{t("Run by each clan's leader and officers, on the Clan tab. Off: what they have is kept, out of sight.")}</span>
      {act.error && <span className="text-danger" role="alert">{act.error}</span>}
    </label>
  );
}

// t() where shown.
const RULES: Record<RuleKind, { title: string; note: string }> = {
  attend: { title: "For being there", note: "in voice at least this share of the operation" },
  hourly: { title: "Per hour in voice", note: "for each hour in voice, rounded" },
  onTime: { title: "On time", note: "in voice within this many minutes of the start" },
  toEnd: { title: "To the end", note: "still in voice this many minutes before the end, or later" },
  came: { title: "Came as they said", note: "said \"coming\" and earned for being there" },
  noShow: { title: "Did not show", note: "taken: said \"coming\" and never in voice" },
  standby: { title: "Standby", note: "ticked in the draft for players kept on the bench" },
  objective: { title: "Objective", note: "ticked in the draft when reached; to everyone who earned for being there" },
};
const RULE_ORDER: RuleKind[] = ["attend", "hourly", "onTime", "toEnd", "came", "noShow", "standby", "objective"];

/** Event kinds to pick from: none picked means every kind. */
function KindPicker({ all, picked, onChange, label }: { all: string[]; picked: string[]; onChange: (k: string[]) => void; label: string }) {
  if (all.length === 0) return null;
  const toggle = (k: string) => onChange(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  return (
    <span className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <button type="button" aria-pressed={picked.length === 0} className={`rounded-sm border px-1.5 text-xs ${picked.length === 0 ? "border-gold text-gold-bright" : "border-line text-text-muted"}`} onClick={() => onChange([])}>
        {t("Every kind")}
      </button>
      {all.map((k) => (
        <button key={k} type="button" aria-pressed={picked.includes(k)} className={`rounded-sm border px-1.5 text-xs ${picked.includes(k) ? "border-gold text-gold-bright" : "border-line text-text-muted"}`} onClick={() => toggle(k)} data-points-kind={k}>
          {k}
        </button>
      ))}
    </span>
  );
}

function RuleRow({ rule, eventTypes, onChange, onRemove, index }: { rule: Rule; eventTypes: string[]; onChange: (r: Rule) => void; onRemove: () => void; index: number }) {
  const info = RULES[rule.kind];
  return (
    <li className="flex flex-col gap-1 border-t border-line py-2 first:border-0" data-points-rule={index}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 font-medium">{t(info.title)}</span>
        {rule.kind === "objective" && (
          <input className="field w-40" maxLength={32} value={rule.label ?? ""} placeholder={t("Boss kill")} onChange={(e) => onChange({ ...rule, label: e.target.value })} aria-label={t("Objective's name")} data-points-rule-label />
        )}
        <input className="field w-24" type="number" min={0} value={rule.amount} onChange={(e) => onChange({ ...rule, amount: num(e.target.value) })} aria-label={t(`${d(t(info.title))}: points`)} data-points-rule-amount />
        {rule.kind === "attend" && (
          <>
            <span className="contents text-text-muted">
              {tx("at {share} %", { share: <input className="field w-20" type="number" min={0} max={100} value={rule.minShare ?? 50} onChange={(e) => onChange({ ...rule, minShare: num(e.target.value, 100) })} aria-label={t("Share of the operation")} data-points-rule-share /> })}
            </span>
          </>
        )}
        {(rule.kind === "onTime" || rule.kind === "toEnd") && (
          <>
            <span className="contents text-text-muted">
              {tx("within {minutes} min", { minutes: <input className="field w-20" type="number" min={0} max={600} value={rule.minutes ?? 15} onChange={(e) => onChange({ ...rule, minutes: num(e.target.value, 600) })} aria-label={t("Minutes")} data-points-rule-minutes /> })}
            </span>
          </>
        )}
        <span className="flex-1 text-xs text-text-muted">{t(info.note)}</span>
        <button type="button" className="btn btn-quiet px-2 py-0.5 text-xs" onClick={onRemove} aria-label={t(`Remove the rule ${d(t(info.title))}`)} data-points-rule-remove>{t("Remove")}</button>
      </div>
      {eventTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:pl-42">
          <span className="text-xs text-text-muted">{t("For")}</span>
          <KindPicker all={eventTypes} picked={rule.kinds} onChange={(kinds) => onChange({ ...rule, kinds })} label={t(`${d(t(info.title))}: kinds of event`)} />
        </div>
      )}
    </li>
  );
}

function PointsForm({ pool, eventTypes, presets, onSaved, onRemoved }: { pool: PoolInfo; eventTypes: string[]; presets: Preset[]; onSaved: () => void; onRemoved: () => void }) {
  const act = useAct();
  const [s, setS] = useState<PoolSettings>(pool.settings);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState<RuleKind | "">("");
  const set = (patch: Partial<PoolSettings>) => {
    setSaved(false);
    setS((x) => ({ ...x, ...patch }));
  };
  const changed = JSON.stringify(s) !== JSON.stringify(pool.settings);
  const save = () =>
    void act.run(() => rpc("points.setPool", { poolId: pool.id, settings: s })).then((ok) => {
      if (ok) {
        setSaved(true);
        onSaved();
      }
    });
  const addRule = (kind: RuleKind) => {
    const rule: Rule = { kind, amount: kind === "attend" || kind === "hourly" ? 10 : 2, kinds: [] };
    if (kind === "attend") rule.minShare = 50;
    if (kind === "onTime" || kind === "toEnd") rule.minutes = 15;
    if (kind === "objective") rule.label = "";
    set({ rules: [...s.rules, rule] });
    setAdding("");
  };
  return (
    <div className="flex flex-col gap-3" data-points-form={pool.id}>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-points-enabled />
        {t("Switched on")}
        <span className="text-xs text-text-muted">{pool.clanId === null ? t("Off: nobody in the alliance sees these points, and no operation waits for them.") : t("Off: the clan's members do not see these points.")}</span>
      </label>
      <label className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-text-muted">{t("Called")}</span>
        <input className="field w-40" value={s.name} maxLength={16} onChange={(e) => set({ name: e.target.value })} aria-label={t("What the points are called")} data-points-name />
        <span className="text-xs text-text-muted">{t("DKP, EP, PAP, Raid points: whatever your players say.")}</span>
      </label>
      <PresetSwap presets={presets} current={s.preset} onPick={(preset, from) => set({ preset, rules: from.rules, decay: from.decay, limits: from.limits, spending: from.spending, ...(from.gear ? { gear: from.gear } : {}) })} />
      {eventTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-text-muted">{t("Counts")}</span>
          <KindPicker all={eventTypes} picked={s.kinds} onChange={(kinds) => set({ kinds })} label={t("Kinds of event these points count")} />
          <span className="text-xs text-text-muted">{t("Which operations earn these points.")}</span>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-line pt-3" data-points-rules>
        <h3 className="text-sm text-gold">{t("How they are earned")}</h3>
        {s.rules.length === 0 ? (
          <p className="text-sm text-text-muted">{t("No rules yet: every operation's draft starts at zero. Add a rule below.")}</p>
        ) : (
          <ul className="flex flex-col">
            {s.rules.map((r, i) => (
              <RuleRow key={i} index={i} rule={r} eventTypes={eventTypes} onChange={(nr) => set({ rules: s.rules.map((x, j) => (j === i ? nr : x)) })} onRemove={() => set({ rules: s.rules.filter((_, j) => j !== i) })} />
            ))}
          </ul>
        )}
        {s.rules.length < 30 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <select className="field w-auto" value={adding} onChange={(e) => e.target.value && addRule(e.target.value as RuleKind)} aria-label={t("Add a rule")} data-points-add-rule>
              <option value="">{t("Add a rule…")}</option>
              {RULE_ORDER.map((k) => (
                <option key={k} value={k}>{t(RULES[k].title)}</option>
              ))}
            </select>
            {eventTypes.length > 0 && <span className="text-xs text-text-muted">{t("A rule for one kind of event takes the place of the same rule for every kind.")}</span>}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <h3 className="text-sm text-gold">{t("Loot, decay and limits")}</h3>
        <label className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-text-muted">{t("Loot")}</span>
          <select className="field w-auto" value={s.spending ?? "none"} onChange={(e) => set({ spending: e.target.value as PoolSettings["spending"] })} aria-label={t("How loot is paid for")} data-points-spending>
            <option value="none">{t("Not spent on loot")}</option>
            <option value="price">{t("Spent: the item's price is taken from the winner")}</option>
            <option value="council">{t("Loot council: a record of who got what and why, no cost")}</option>
            <option value="epgp">{t("EPGP: the price is added to the winner's gear points; priority is EP divided by GP")}</option>
            <option value="zeroSum">{t("Zero-sum: the price is taken from the winner and shared among the others there")}</option>
            <option value="list">{t("Suicide Kings: no cost; the winner goes to the bottom of a list")}</option>
          </select>
          <span className="text-xs text-text-muted">{t("Loot is recorded and given out on an operation's board.")}</span>
        </label>
        {s.spending === "epgp" && (
          <label className="flex flex-wrap items-center gap-2" data-points-gear>
            <span className="w-40 text-text-muted">{t("Gear points")}</span>
            <span className="contents text-text-muted">
              {tx(`base {base} GP; first in line needs at least {least} ${d(s.name)}`, {
                base: <input className="field w-24" type="number" min={1} value={s.gear?.baseGp ?? 100} onChange={(e) => set({ gear: { baseGp: Math.max(1, num(e.target.value, 10_000_000)), minEp: s.gear?.minEp ?? 0 } })} aria-label={t("Base GP")} data-points-base-gp />,
                least: <input className="field w-24" type="number" min={0} value={s.gear?.minEp ?? 0} onChange={(e) => set({ gear: { baseGp: s.gear?.baseGp ?? 100, minEp: num(e.target.value, 10_000_000) } })} aria-label={t("Minimum EP")} data-points-min-ep />,
              })}
            </span>
            <span className="text-xs text-text-muted">{t("Everyone starts from the base, so a new player is not first in line for everything. 0 for no minimum.")}</span>
          </label>
        )}
        {s.spending === "zeroSum" && !s.limits.negative && <p className="text-xs text-gold">{t("Zero-sum works with points that may go below zero: otherwise a player needs points before winning anything.")}</p>}
        <label className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-text-muted">{t("Decay")}</span>
          <span className="contents text-text-muted">
            {tx("{percent} % every {period} not below {floor}", {
              percent: <input className="field w-20" type="number" min={0} max={100} value={s.decay.pct} onChange={(e) => set({ decay: { ...s.decay, pct: num(e.target.value, 100) } })} aria-label={t("Decay in percent")} data-points-decay />,
              period: (
                <select className="field w-auto" value={s.decay.every} onChange={(e) => set({ decay: { ...s.decay, every: e.target.value as "week" | "month" } })} aria-label={t("How often decay is taken")} data-points-decay-every>
                  <option value="week">{t("week (Monday)")}</option>
                  <option value="month">{t("month (the 1st)")}</option>
                </select>
              ),
              floor: <input className="field w-24" type="number" min={0} value={s.decay.floor} onChange={(e) => set({ decay: { ...s.decay, floor: num(e.target.value, 10_000_000) } })} aria-label={t("Decay floor")} data-points-decay-floor />,
            })}
          </span>
          <span className="text-xs text-text-muted">{t("0% for none. Recent effort counts most.")}</span>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-text-muted">{t("Cap")}</span>
          <input className="field w-24" type="number" min={0} value={s.limits.cap} onChange={(e) => set({ limits: { ...s.limits, cap: num(e.target.value, 10_000_000) } })} aria-label={t("Most points a player may have")} data-points-cap />
          <span className="text-xs text-text-muted">{t("The most a player may have. 0 for no cap.")}</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.limits.negative} onChange={(e) => set({ limits: { ...s.limits, negative: e.target.checked } })} data-points-negative />
          {t("May go below zero")}
          <span className="text-xs text-text-muted">{t("Off: a deduction stops at zero.")}</span>
        </label>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        {pool.clanId === null && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.eventLeaderPosts} onChange={(e) => set({ eventLeaderPosts: e.target.checked })} data-points-leader-posts />
            {t("An operation's event leader may post its points")}
            <span className="text-xs text-text-muted">{t("Off: only the alliance's admins do.")}</span>
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.open} onChange={(e) => set({ open: e.target.checked })} data-points-open />
          {t("Everyone sees the standings")}
          <span className="text-xs text-text-muted">{pool.clanId === null ? t("Off: admins see all, a clan's leader and officers their clan, each player their own.") : t("Off: the clan's leader and officers see all, each player their own.")}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" disabled={!changed || act.busy} onClick={save} data-points-save>{t("Save the points")}</button>
        {saved && !changed && <span className="text-sm text-text-muted" role="status">{t("Saved.")}</span>}
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
      </div>
      <SeasonAndRemove pool={pool} onDone={onSaved} onRemoved={onRemoved} />
    </div>
  );
}

/** Replaces the rules, decay and limits with a preset's, after asking. */
function PresetSwap({ presets, current, onPick }: { presets: Preset[]; current: PresetId; onPick: (id: PresetId, s: PoolSettings) => void }) {
  const [want, setWant] = useState<PresetId | "">("");
  const act = useAct();
  const title = presets.find((p) => p.id === current)?.title ?? current;
  // The preset's own settings are the server's; asked for by making nothing (a dry run is the overview's list).
  const apply = () => {
    if (!want) return;
    let got: PoolSettings | null = null;
    void act.run(async () => (got = (await rpc<{ settings: PoolSettings }>("points.presetSettings", { preset: want })).settings)).then((ok) => {
      if (ok && got) onPick(want, got);
      setWant("");
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-40 text-text-muted">{t("Preset")}</span>
      <span>{title}</span>
      <select className="field w-auto" value={want} onChange={(e) => setWant(e.target.value as PresetId | "")} aria-label={t("Start again from a preset")} data-points-swap>
        <option value="">{t("Start again from…")}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
      </select>
      {want && (
        <>
          <span className="text-xs text-text-muted">{t("This replaces the rules, decay and limits below (not the name). Nothing is saved until you save.")}</span>
          <button type="button" className="btn btn-quiet text-sm" disabled={act.busy} onClick={apply} data-points-swap-go>{t("Replace")}</button>
        </>
      )}
      {act.error && <span className="text-danger" role="alert">{act.error}</span>}
    </div>
  );
}

function SeasonAndRemove({ pool, onDone, onRemoved }: { pool: PoolInfo; onDone: () => void; onRemoved: () => void }) {
  const act = useAct();
  const [carry, setCarry] = useState("0");
  const [asking, setAsking] = useState<"season" | "remove" | null>(null);
  const name = pool.settings.name;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-text-muted">{t("Season")}</span>
        <span data-points-season>{pool.seasonAt ? t(`Season ${d(pool.season)}, since ${d(day(pool.seasonAt))}`) : t(`Season ${d(pool.season)}`)}</span>
        {asking !== "season" ? (
          <button type="button" className="btn btn-quiet text-sm" onClick={() => setAsking("season")} data-points-season-start>{t("Start a new season…")}</button>
        ) : (
          <>
            <span className="contents text-text-muted">
              {tx(`carry over {share} % of everyone's ${d(name)}?`, { share: <input className="field w-20" type="number" min={0} max={100} value={carry} onChange={(e) => setCarry(e.target.value)} aria-label={t("Share carried over, in percent")} data-points-carry /> })}
            </span>
            <button type="button" className="btn text-sm" disabled={act.busy} onClick={() => void act.run(() => rpc("points.newSeason", { poolId: pool.id, carry: num(carry, 100) })).then((ok) => ok && (setAsking(null), onDone()))} data-points-season-go>{t("Start it")}</button>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setAsking(null)}>{t("Not now")}</button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {asking !== "remove" ? (
          <button type="button" className="btn btn-quiet self-start text-xs" onClick={() => setAsking("remove")} data-points-remove>{t("Remove these points…")}</button>
        ) : (
          <>
            <span>{t(`Remove ${d(name)}? Only points with no lines yet can be removed; otherwise switch them off.`)}</span>
            <button type="button" className="btn text-sm" disabled={act.busy} onClick={() => void act.run(() => rpc("points.removePool", { poolId: pool.id })).then((ok) => ok && onRemoved())} data-points-remove-go>{t("Remove")}</button>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setAsking(null)}>{t("Keep them")}</button>
          </>
        )}
      </div>
      {act.error && <span className="text-danger" role="alert">{act.error}</span>}
    </div>
  );
}

const decayLine = (decay: PoolSettings["decay"]) =>
  decay.every === "month"
    ? decay.floor ? t(`Decay: ${d(decay.pct)}% every month, not below ${d(decay.floor)}`) : t(`Decay: ${d(decay.pct)}% every month`)
    : decay.floor ? t(`Decay: ${d(decay.pct)}% every week, not below ${d(decay.floor)}`) : t(`Decay: ${d(decay.pct)}% every week`);

/** The rules as a player reads them, under the standings. */
function RulesSummary({ s }: { s: PoolSettings }) {
  if (s.rules.length === 0 && s.decay.pct === 0) return null;
  const line = (r: Rule) => {
    const info = RULES[r.kind];
    const what = r.kind === "objective" ? r.label : t(info.title);
    const extra = r.kind === "attend" ? ` (${t(`${d(r.minShare ?? 50)}% of the operation`)})` : r.kind === "onTime" || r.kind === "toEnd" ? ` (${t(`${d(r.minutes ?? 15)} min`)})` : "";
    const amount = `${r.kind === "noShow" ? "−" : ""}${r.amount}`;
    return `${what}${extra}: ${r.kind === "hourly" ? t(`${d(amount)} an hour`) : amount}${r.kinds.length ? ` · ${r.kinds.join(", ")}` : ""}`;
  };
  return (
    <details className="text-xs text-text-muted" data-points-rules-summary>
      <summary className="cursor-pointer">{t(`How ${d(s.name)} are earned`)}</summary>
      <ul className="mt-1 flex flex-col gap-0.5 pl-3">
        {s.rules.map((r, i) => (
          <li key={i}>{line(r)}</li>
        ))}
        {s.decay.pct > 0 && <li>{decayLine(s.decay)}</li>}
        {s.limits.cap > 0 && <li>{t(`Cap: ${d(s.limits.cap)}`)}</li>}
      </ul>
    </details>
  );
}

// ---- Standings ----

/** A pool's standings, a player's lines, adjustments by hand, and the operations waiting for their points. */
export function PointsStandings({ pool }: { pool: PoolInfo }) {
  const { info, tick } = useApp();
  const [data, setData] = useState<Standings | null>(null);
  const [error, setError] = useState("");
  const [player, setPlayer] = useState<number | null>(null);
  const [opId, setOpId] = useState<number | null>(null);
  const [again, setAgain] = useState(0);
  const reload = () => setAgain((n) => n + 1);
  useEffect(() => {
    let live = true;
    rpc<Standings>("points.standings", { poolId: pool.id })
      .then((r) => live && (setData(r), setError("")))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [pool.id, tick, again]);

  if (error) return <p className="text-danger" role="alert">{error}</p>;
  if (!data) return <p className="text-text-muted">{t("Loading…")}</p>;
  const name = data.pool.settings.name;
  if (opId !== null) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="btn btn-quiet self-start text-sm" onClick={() => (setOpId(null), reload())}>{t("Back to the standings")}</button>
        <OpPoints opId={opId} onPosted={reload} only={pool.id} />
      </div>
    );
  }
  if (player !== null) return <PlayerLines poolId={pool.id} userId={player} manage={data.pool.manage} onBack={() => (setPlayer(null), reload())} />;
  const decays = data.rows.some((r) => r.decayed !== 0);
  const spends = data.rows.some((r) => (r.spent ?? 0) !== 0);
  const epgp = data.pool.settings.spending === "epgp";
  if (data.pool.settings.spending === "list") return <ListStandings data={data} onPlayer={setPlayer} onChange={reload} />;
  return (
    <div className="flex flex-col gap-4" data-points-standings={pool.id}>
      {data.waiting.length > 0 && (
        <section className="panel flex flex-col gap-2 border-gold-dim p-4" data-points-waiting>
          <h2 className="title title-rule text-sm text-gold">{t(`Operations waiting for their ${d(name)}`)}</h2>
          <ul className="flex flex-col divide-y divide-line">
            {data.waiting.map((w) => (
              <li key={w.id} className="flex items-center gap-3 py-1.5">
                <span className="flex-1">{w.name}{w.eventType && <span className="text-xs text-text-muted"> · {w.eventType}</span>}</span>
                <span className="text-xs text-text-muted">{day(w.endedAt)}</span>
                <button type="button" className="btn text-sm" onClick={() => setOpId(w.id)} data-points-review={w.id}>{t("Review and post")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="title title-rule flex-1 text-sm text-gold">{t(`${d(name)}: standings`)}</h2>
          {data.pool.season > 1 && <span className="text-xs text-text-muted">{data.pool.seasonAt ? t(`Season ${d(data.pool.season)}, since ${d(day(data.pool.seasonAt))}`) : t(`Season ${d(data.pool.season)}`)}</span>}
          <button type="button" className="btn btn-quiet text-xs" onClick={() => setPlayer(info.user.id)} data-points-mine>{t("My own lines")}</button>
        </div>
        {!data.pool.seeAll && <p className="text-xs text-text-muted">{data.rows.length > 1 ? t("You see your own clan's players.") : t("You see your own points. The standings are not open to everyone.")}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="py-1 pr-3 font-normal">#</th>
                <th className="py-1 pr-3 font-normal">{t("Player")}</th>
                {epgp && <th className="py-1 pr-3 text-right font-normal">{t("Priority")}</th>}
                <th className="py-1 pr-3 text-right font-normal">{name}</th>
                {epgp && <th className="py-1 pr-3 text-right font-normal">{own("GP")}</th>}
                <th className="py-1 pr-3 text-right font-normal">{t("From operations")}</th>
                <th className="py-1 pr-3 text-right font-normal">{t("By hand")}</th>
                {spends && <th className="py-1 pr-3 text-right font-normal">{t("On loot")}</th>}
                {decays && <th className="py-1 pr-3 text-right font-normal">{t("Decay and seasons")}</th>}
                <th className="py-1 font-normal">{t("Last change")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.userId} className={`cursor-pointer border-t border-line hover:bg-bg-2 ${r.userId === info.user.id ? "bg-bg-2/60" : ""}`} onClick={() => setPlayer(r.userId)} data-points-row={r.userId}>
                  <td className="py-1 pr-3 tabular-nums text-text-muted">{i + 1}</td>
                  <td className="py-1 pr-3">
                    <button type="button" className="cursor-pointer text-left text-gold hover:text-gold-bright" onClick={() => setPlayer(r.userId)}>{r.name}</button>
                    {r.clanTag && <span className="text-[11px] text-text-muted"> [{r.clanTag}]</span>}
                  </td>
                  {epgp && (
                    <td className={`py-1 pr-3 text-right font-semibold tabular-nums ${r.minReached === false ? "text-text-muted" : "text-gold"}`} title={r.minReached === false ? t(`Below the minimum of ${d(data.pool.settings.gear?.minEp ?? 0)} ${d(name)}`) : undefined} data-points-pr>{r.priority ?? ""}</td>
                  )}
                  <td className={`py-1 pr-3 text-right ${epgp ? "" : "font-semibold"} tabular-nums ${r.points < 0 ? "text-danger" : ""}`} data-points-total>{r.points}</td>
                  {epgp && <td className="py-1 pr-3 text-right tabular-nums" data-points-gp>{r.gp ?? 0}</td>}
                  <td className="py-1 pr-3 text-right tabular-nums text-text-muted">{r.earned || ""}</td>
                  <td className="py-1 pr-3 text-right tabular-nums text-text-muted">{r.adjusted ? signed(r.adjusted) : ""}</td>
                  {spends && <td className="py-1 pr-3 text-right tabular-nums text-text-muted" data-points-spent>{r.spent ? signed(r.spent) : ""}</td>}
                  {decays && <td className="py-1 pr-3 text-right tabular-nums text-text-muted" data-points-decayed>{r.decayed ? signed(r.decayed) : ""}</td>}
                  <td className="py-1 text-text-muted">{r.lastAt ? day(r.lastAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {epgp && <p className="text-xs text-text-muted">{(data.pool.settings.gear?.minEp ?? 0) > 0
          ? t(`Priority is ${d(name)} divided by (${d(data.pool.settings.gear?.baseGp ?? 100)} + GP), highest first; players under ${d(data.pool.settings.gear?.minEp ?? 0)} ${d(name)} come after everyone else.`)
          : t(`Priority is ${d(name)} divided by (${d(data.pool.settings.gear?.baseGp ?? 100)} + GP), highest first.`)}</p>}
        <RulesSummary s={data.pool.settings} />
      </section>
    </div>
  );
}

/** A Suicide Kings list: places, and for those who run it, moving players and shuffling. */
function ListStandings({ data, onPlayer, onChange }: { data: Standings; onPlayer: (id: number) => void; onChange: () => void }) {
  const { info } = useApp();
  const act = useAct();
  const rows = data.rows;
  const manage = data.pool.manage;
  const send = (order: number[] | "shuffle") => void act.run(() => rpc("points.setOrder", { poolId: data.pool.id, order })).then((ok) => ok && onChange());
  const move = (i: number, by: number) => {
    const ids = rows.map((r) => r.userId);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    send(ids);
  };
  return (
    <section className="panel flex flex-col gap-3 p-5" data-points-standings={data.pool.id}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="title title-rule flex-1 text-sm text-gold">{data.pool.settings.name}</h2>
        {manage && <button type="button" className="btn btn-quiet text-xs" disabled={act.busy} onClick={() => send("shuffle")} data-points-shuffle>{t("Shuffle")}</button>}
      </div>
      <p className="text-xs text-text-muted">{t("Whoever takes an item goes to the bottom; those below who were in voice at the operation move up one, and those who were not keep their place. Newcomers join at the bottom.")}</p>
      {!data.pool.seeAll && <p className="text-xs text-text-muted">{t("You see your own place. The list is not open to everyone.")}</p>}
      <ol className="flex flex-col divide-y divide-line">
        {rows.map((r, i) => (
          <li key={r.userId} className={`flex items-center gap-3 py-1 ${r.userId === info.user.id ? "bg-bg-2/60" : ""}`} data-points-row={r.userId}>
            <span className="w-8 text-right font-semibold tabular-nums text-gold" data-points-place>{r.position ?? i + 1}</span>
            <button type="button" className="flex-1 cursor-pointer text-left hover:text-gold-bright" onClick={() => onPlayer(r.userId)}>
              {r.name}
              {r.clanTag && <span className="text-[11px] text-text-muted"> [{r.clanTag}]</span>}
            </button>
            {manage && (
              <>
                <button type="button" className="btn btn-quiet px-2 py-0 text-xs" disabled={act.busy || i === 0} onClick={() => move(i, -1)} aria-label={t(`Move ${d(r.name)} up`)} data-points-up>↑</button>
                <button type="button" className="btn btn-quiet px-2 py-0 text-xs" disabled={act.busy || i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t(`Move ${d(r.name)} down`)} data-points-down>↓</button>
              </>
            )}
          </li>
        ))}
      </ol>
      {act.error && <span className="text-danger" role="alert">{act.error}</span>}
    </section>
  );
}

function PlayerLines({ poolId, userId, manage, onBack }: { poolId: number; userId: number; manage: boolean; onBack: () => void }) {
  const [data, setData] = useState<PlayerPoints | null>(null);
  const [error, setError] = useState("");
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    rpc<PlayerPoints>("points.player", { poolId, userId })
      .then((r) => live && (setData(r), setError("")))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [poolId, userId, again]);
  const what = (e: Entry) =>
    e.kind === "earned" ? (
      <>
        {e.label ?? t("An operation")}
        {e.reason && <span className="text-xs text-text-muted"> · {e.reason}</span>}
      </>
    ) : e.kind === "spent" || e.kind === "refund" || e.kind === "share" ? (
      <>
        {e.label}
        <span className="text-xs text-text-muted">{" · "}{e.kind === "spent" ? t("loot") : e.kind === "share" ? (e.reason === "Taken back" ? t("share taken back") : (e.reason ?? t("share"))) : t("taken back")}</span>
      </>
    ) : e.kind === "adjust" ? (
      <>
        {e.reason}
        <span className="text-xs text-text-muted"> · {t("by hand")}</span>
      </>
    ) : (
      <span className="text-text-muted">{e.label}</span>
    );
  return (
    <div className="flex flex-col gap-3" data-points-player={userId}>
      <button type="button" className="btn btn-quiet self-start text-sm" onClick={onBack}>{t("Back to the standings")}</button>
      {error && <p className="text-danger" role="alert">{error}</p>}
      {data && (
        <section className="panel flex flex-col gap-3 p-5">
          <div className="flex items-baseline gap-3">
            <h2 className="title flex-1 text-gold-bright">{data.player.name}</h2>
            <span className="text-2xl font-semibold tabular-nums" data-points-balance>{data.points}</span>
            <span className="text-text-muted">{data.pool.settings.name}</span>
            {data.pool.settings.spending === "epgp" && (
              <>
                <span className="text-2xl font-semibold tabular-nums" data-points-gp-balance>{data.gp ?? 0}</span>
                <span className="text-text-muted">{own("GP")}</span>
              </>
            )}
          </div>
          {manage && <AdjustForm poolId={poolId} userId={userId} name={data.pool.settings.name} gear={data.pool.settings.spending === "epgp"} onDone={() => setAgain((n) => n + 1)} />}
          {data.entries.length === 0 ? (
            <p className="text-text-muted">{t("Nothing yet.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line" data-points-lines>
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-baseline gap-3 py-1.5" data-points-line={e.kind}>
                  <span className={`w-16 text-right font-semibold tabular-nums ${(e.amount || e.gp || 0) < 0 ? "text-danger" : "text-net-party"}`}>{e.amount === 0 && e.gp ? `${signed(e.gp)} GP` : signed(e.amount)}</span>
                  {e.amount !== 0 && e.gp ? <span className="text-xs tabular-nums text-text-muted">{`${signed(e.gp)} GP`}</span> : null}
                  <span className="flex-1">{what(e)}</span>
                  <span className="text-xs text-text-muted">{e.by ? `${e.by}, ` : ""}{day(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function AdjustForm({ poolId, userId, name, gear, onDone }: { poolId: number; userId: number; name: string; gear: boolean; onDone: () => void }) {
  const act = useAct();
  const [track, setTrack] = useState<"points" | "gp">("points");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const send = () => {
    const asked = Math.trunc(Number(amount));
    let written = asked;
    void act.run(async () => (written = (await rpc<{ amount: number }>("points.adjust", { poolId, userId, amount: asked, reason, ...(track === "gp" ? { track } : {}) })).amount)).then((ok) => {
      if (ok) {
        setAmount("");
        setReason("");
        setNote(written !== asked ? t(`The limits allowed ${d(signed(written))} of ${d(signed(asked))}.`) : "");
        onDone();
      }
    });
  };
  return (
    <form className="flex flex-wrap items-center gap-2 border-y border-line py-2" onSubmit={(e) => (e.preventDefault(), send())} data-points-adjust>
      <span className="text-text-muted">{t("Give or take")}</span>
      <input className="field w-32" type="number" placeholder={t("+10 or -10")} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t(`${d(track === "gp" ? "GP" : name)} to give (negative to take)`)} />
      {gear && (
        <select className="field w-auto" value={track} onChange={(e) => setTrack(e.target.value as "points" | "gp")} aria-label={t("Points or gear points")} data-points-track>
          <option value="points">{name}</option>
          <option value="gp">{own("GP")}</option>
        </select>
      )}
      <input className="field min-w-0 flex-1" maxLength={120} placeholder={t("Why (the player sees this)")} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Reason")} />
      <button type="submit" className="btn text-sm" disabled={act.busy || !amount || Number(amount) === 0 || !reason.trim()}>{t("Add the line")}</button>
      {note && <span className="w-full text-xs text-text-muted" role="status" data-points-limited>{note}</span>}
      {act.error && <span className="w-full text-danger" role="alert">{act.error}</span>}
    </form>
  );
}

// ---- An operation's points ----

/** On an ended operation's board, and from the standings: its points in each pool, posted or as a draft to review. */
export function OpPoints({ opId, onPosted, only }: { opId: number; onPosted?: () => void; only?: number }) {
  const { tick } = useApp();
  const [data, setData] = useState<OpPointsData | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    rpc<OpPointsData>("points.op", { opId })
      .then((r) => live && setData(r))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [opId, tick, again]);
  if (!data || data.pools.length === 0) return null;
  const shown = data.pools.filter((p) => (p.posted || p.canPost) && (only === undefined || p.pool.id === only));
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((p) => (
        <section key={p.pool.id} className="panel flex flex-col gap-3 p-5" data-points-op={p.pool.id}>
          <h2 className="title title-rule text-sm text-gold">
            {poolTitle(p.pool)}
            <Help text={t(POINTS_HELP)} />
          </h2>
          {p.posted ? <Posted p={p} /> : <Draft p={p} op={data.op} onPosted={() => (setAgain((n) => n + 1), onPosted?.())} />}
        </section>
      ))}
    </>
  );
}

function Posted({ p }: { p: OpPool }) {
  const got = p.rows.filter((r) => r.amount);
  return (
    <>
      <p className="text-xs text-text-muted" data-points-posted>
        {p.posted?.by
          ? t(`Posted by ${d(p.posted.by)} on ${d(day(p.posted.at))}. Changes since then are made by hand and show on each player's lines.`)
          : t(`Posted on ${d(day(p.posted!.at))}. Changes since then are made by hand and show on each player's lines.`)}
      </p>
      {got.length === 0 ? (
        <p className="text-text-muted">{t("Nobody you can see got any.")}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-1 text-sm">
          {got.map((r) => (
            <li key={r.userId} className="flex flex-col">
              <span className="flex gap-2">
                <span className="flex-1 truncate">{r.name}</span>
                <span className={`tabular-nums ${r.amount! < 0 ? "text-danger" : ""}`} data-points-got={r.userId}>{signed(r.amount!)}</span>
              </span>
              {r.why && <span className="truncate text-[11px] text-text-muted">{r.why}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Draft({ p, op, onPosted }: { p: OpPool; op: OpPointsData["op"]; onPosted: () => void }) {
  const act = useAct();
  const [ticked, setTicked] = useState<string[]>([]);
  const [standby, setStandby] = useState<number[]>([]);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState(0);
  const [extraInput, setExtraInput] = useState("");
  const [sure, setSure] = useState(false);
  const name = p.pool.settings.name;

  /** A row's parts with what is ticked: standby replaces the no-show deduction; objectives go to those who earned for being there. */
  const partsOf = (r: OpRow): Part[] => {
    let parts = r.suggested.parts.slice();
    if (p.standby !== null && standby.includes(r.userId)) parts = [...parts.filter((x) => x.what !== "did not show"), { what: "standby", amount: p.standby }];
    if (r.attended) for (const o of p.objectives) if (ticked.includes(o.label)) parts.push({ what: o.label, amount: o.amount });
    if (extra && r.attended) parts.push({ what: "extra", amount: extra });
    return parts.filter((x) => x.amount !== 0);
  };
  const computed = (r: OpRow) => partsOf(r).reduce((t, x) => t + x.amount, 0);
  const value = (r: OpRow) => (r.userId in edited ? Math.trunc(Number(edited[r.userId]) || 0) : computed(r));
  const why = (r: OpRow) => {
    const text = partsText(partsOf(r));
    return r.userId in edited && value(r) !== computed(r) ? `${text ? `${text}; ` : ""}${t(`set to ${d(value(r))} by hand`)}` : text;
  };
  const total = p.rows.reduce((t, r) => t + value(r), 0);
  const players = p.rows.filter((r) => value(r) !== 0).length;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const post = () =>
    void act
      .run(() => rpc("points.post", { poolId: p.pool.id, opId: op.id, objectives: ticked, rows: p.rows.map((r) => ({ userId: r.userId, amount: value(r), why: why(r) })) }))
      .then((ok) => ok && onPosted());
  return (
    <div className="flex flex-col gap-3" data-points-draft>
      <p className="text-sm text-text-muted">
        {t(`A draft from who was in voice: the operation ran ${d(dur(op.seconds))}. Tick what applies, change any amount, then post. Nothing is added until you do, and it is posted once.`)}
      </p>
      {p.objectives.length > 0 && (
        <div className="flex flex-wrap items-center gap-3" data-points-objectives>
          <span className="text-text-muted">{t("Reached")}</span>
          {p.objectives.map((o) => (
            <label key={o.label} className="flex items-center gap-1.5">
              <input type="checkbox" checked={ticked.includes(o.label)} onChange={() => setTicked((x) => toggle(x, o.label))} data-points-objective={o.label} />
              {o.label} <span className="text-xs text-text-muted">+{o.amount}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-muted">{t("Add to everyone who earned for being there")}</span>
        <input className="field w-20" type="number" value={extraInput} onChange={(e) => setExtraInput(e.target.value)} placeholder="+5" aria-label={t("Add to everyone who earned for being there")} data-points-extra />
        <button type="button" className="btn btn-quiet text-sm" disabled={!Number(extraInput)} onClick={() => (setExtra((x) => x + Math.trunc(Number(extraInput))), setExtraInput(""))}>{t("Add")}</button>
        {extra !== 0 && <span className="text-xs text-text-muted">{t(`${d(signed(extra))} each so far`)}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-text-muted">
              <th className="py-1 pr-3 font-normal">{t("Player")}</th>
              <th className="py-1 pr-3 text-right font-normal">{t("In voice")}</th>
              <th className="py-1 pr-3 font-normal">{t("Said")}</th>
              {p.standby !== null && <th className="py-1 pr-3 font-normal">{t("Standby")}</th>}
              <th className="py-1 pr-3 font-normal">{t("Why")}</th>
              <th className="py-1 text-right font-normal">{name}</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.userId} className="border-t border-line" data-points-draft-row={r.userId}>
                <td className="py-1 pr-3">{r.name}{r.clanTag && <span className="text-[11px] text-text-muted"> [{r.clanTag}]</span>}</td>
                <td className="py-1 pr-3 text-right tabular-nums text-text-muted">{r.seconds > 0 ? dur(r.seconds) : t("Not in voice")}</td>
                <td className="py-1 pr-3 text-text-muted">{r.signup === "coming" ? t("Coming") : r.signup === "out" ? t("Can't come") : ""}</td>
                {p.standby !== null && (
                  <td className="py-1 pr-3">
                    <input type="checkbox" checked={standby.includes(r.userId)} onChange={() => setStandby((x) => toggle(x, r.userId))} aria-label={t(`${d(r.name)} was on standby`)} data-points-standby={r.userId} />
                  </td>
                )}
                <td className="py-1 pr-3 text-xs text-text-muted" data-points-why={r.userId}>{why(r) || "0"}</td>
                <td className="py-1 text-right">
                  <input
                    className="field w-20 text-right tabular-nums"
                    type="number"
                    value={r.userId in edited ? edited[r.userId] : String(computed(r))}
                    onChange={(e) => setEdited((x) => ({ ...x, [r.userId]: e.target.value }))}
                    aria-label={t(`${d(name)} for ${d(r.name)}`)}
                    data-points-amount={r.userId}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!sure ? (
          <button type="button" className="btn" disabled={act.busy} onClick={() => setSure(true)} data-points-post>{t(`Post ${d(name)}`)}</button>
        ) : (
          <Fragment>
            <span>{tn(players, `{n} player, ${d(total)} ${d(name)} in all. Post them?`, `{n} players, ${d(total)} ${d(name)} in all. Post them?`)}</span>
            <button type="button" className="btn" disabled={act.busy} onClick={post} data-points-confirm>{t("Post")}</button>
            <button type="button" className="btn btn-quiet" disabled={act.busy} onClick={() => setSure(false)}>{t("Not yet")}</button>
          </Fragment>
        )}
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
      </div>
    </div>
  );
}
