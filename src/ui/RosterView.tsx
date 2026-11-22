import { d, t } from "../words";
import { useGame } from "../game";
import { useState } from "react";
import { rpc, type OpOptions, type OpSummary } from "../api";
import { useAct, useApp, useLoad } from "./app-context";
import { Board } from "./Board";
import { ClanCrest, startTime } from "./common";
import { SignupControl } from "./Signup";
import { Help } from "./tips";

const STATE_LABEL = { live: "Live", planned: "Planned", ended: "Ended" } as const;
const STATE_CLASS = { live: "text-net-party", planned: "text-gold", ended: "text-text-muted" } as const;

// t() where shown.
const OPERATIONS_HELP = [
  "An operation is one event: a siege, a raid, an epic boss.",
  "Each has its own roster of parties and its own nets: Broadcast, Command, Clan, Party and Reserve.",
  "Planned: the roster is being built. Say whether you are coming, so the organiser can plan the parties. Players stay in their lounge unless they choose to form up early.",
  "Live: everyone on the roster is pulled onto its nets.",
  "Ended: everyone is back in their lounge and the roster is locked.",
  "Alliance admins create operations. Open one to see its board.",
].join("\n");

/** An operation's start as it is shown everywhere. */
export const when = startTime;

function NewOperation({ onCreated }: { onCreated: (id: number) => void }) {
  const { info } = useApp();
  const { data } = useLoad(() => rpc<OpOptions>("op.options"), [], 60_000);
  const [name, setName] = useState("");
  const [starts, setStarts] = useState("");
  const [leader, setLeader] = useState(info.user.id);
  const [picked, setPicked] = useState<number[] | null>(null);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [eventType, setEventType] = useState("");
  const game = useGame();
  const act = useAct();
  if (!data) return null;
  if (data.clans.length === 0) return <p className="text-text-muted">{t("Create a clan on the Alliance screen first.")}</p>;
  const clanIds = picked ?? (data.clans.length === 1 ? [data.clans[0].id] : []);

  return (
    <form
      className="flex flex-col gap-3 max-w-xl"
      onSubmit={async (e) => {
        e.preventDefault();
        let id = 0;
        const ok = await act.run(async () => {
          const startsAt = starts ? new Date(starts).toISOString() : null;
          id = (await rpc<{ id: number }>("op.create", { name, eventType, startsAt, eventLeaderId: leader, clanIds, copyFrom })).id;
        });
        if (ok) onCreated(id);
      }}
    >
      <label className="flex flex-col gap-1 text-text-muted">
        Name
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Aden siege" required />
      </label>
      {(game?.eventTypes?.length ?? 0) > 0 && (
        <label className="flex flex-col gap-1 text-text-muted">
          <span className="flex items-center gap-1">
            Kind of event
            <Help text={t("What this operation is, from your alliance's own list. It is shown beside the name, here and in Discord announcements.\nAn alliance admin keeps the list on the Alliance screen, under Game setup.")} />
          </span>
          <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value)} aria-label="Kind of event">
            <option value="">Not said</option>
            {game?.eventTypes?.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      )}
      {data.previous.length > 0 && (
        <label className="flex flex-col gap-1 text-text-muted">
          <span className="flex items-center gap-1">
            Start from
            <Help text={t("Begin with the parties of an earlier operation: the same parties in the same order, with the same leaders, members and deputies.\nOnly players who are still approved members of the clans you tick below are carried over; everyone else starts in Reserve.\nThe earlier operation is not changed. You can rearrange the new one freely afterwards.")} />
          </span>
          <select
            className="field"
            aria-label="Start from"
            value={copyFrom ?? ""}
            onChange={(e) => {
              const from = data.previous.find((p) => p.id === Number(e.target.value)) ?? null;
              setCopyFrom(from?.id ?? null);
              if (from) {
                // Same clans and leader as last time, unless they are gone; both can still be changed below.
                setPicked(from.clanIds.filter((id) => data.clans.some((c) => c.id === id)));
                if (data.users.some((u) => u.id === from.eventLeaderId)) setLeader(from.eventLeaderId);
              }
            }}
          >
            <option value="">An empty roster</option>
            {data.previous.map((p) => (
              <option key={p.id} value={p.id}>{t(`${d(p.name)}: ${d(p.parties)} ${p.parties === 1 ? "party" : "parties"}, ${d(p.players)} ${p.players === 1 ? "player" : "players"}`)}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-text-muted">
        <span className="flex items-center gap-1">
          Starts (your local time, optional)
          <Help text={t("Shown to players so they know when to be ready. Each player sees it in their own local time.\nThe operation does not start by itself: the event leader presses Start operation.")} />
        </span>
        <input type="datetime-local" className="field" value={starts} onChange={(e) => setStarts(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-text-muted">
        <span className="flex items-center gap-1">
          Event leader
          <Help text={t("The player who runs the event. They speak on Broadcast and Command, appoint deputies, build the roster, and start and end the operation.\nIt can be you or anyone who has signed in. Alliance admins keep the same powers over every operation.")} />
        </span>
        <select className="field" value={leader} onChange={(e) => setLeader(Number(e.target.value))}>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}{u.clanTag ? ` [${u.clanTag}]` : ""}</option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-text-muted mb-1 flex items-center gap-1">
          {t("Clans taking part")}
          <Help text={t("Every member of the clans you tick is on this operation's roster, starting in Reserve until placed in a party.\nEach clan gets its own Clan net. Players from other clans cannot join the operation's nets.")} />
        </legend>
        {data.clans.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={clanIds.includes(c.id)}
              onChange={(e) => setPicked(e.target.checked ? [...clanIds, c.id] : clanIds.filter((x) => x !== c.id))}
            />{" "}
            <ClanCrest clanId={c.id} size={16} />
            {c.name} [{c.tag}]
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={act.busy || !name.trim() || clanIds.length === 0}>{t("Create operation")}</button>
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
      </div>
    </form>
  );
}

export function RosterView() {
  const { info, boardOp, go, set } = useApp();
  const { data: ops, error, reload } = useLoad(() => rpc<OpSummary[]>("ops.list"), []);
  const [creating, setCreating] = useState(false);

  if (boardOp !== null) return <Board opId={boardOp} onBack={() => go("roster")} />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <section className="panel p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="title title-rule flex-1 text-sm text-gold">
            {t("Operations")}
            <Help text={t(OPERATIONS_HELP)} />
          </h2>
          {info.user.runsAlliance && !creating && (
            <button type="button" className="btn text-sm" onClick={() => setCreating(true)}>{t("New operation")}</button>
          )}
        </div>
        {error && <p className="text-danger">{error}</p>}
        {ops && ops.length === 0 && (
          <p className="text-text-muted">
            {info.membership?.status === "active" || info.user.runsAlliance
              ? t("No operations yet. Until one starts, you are in the lounge.")
              : t("You will see your clan's operations here once you have been approved.")}
          </p>
        )}
        <ul className="flex flex-col divide-y divide-line">
          {ops?.map((o) => (
            <li key={o.id} className="flex flex-col gap-1 py-1">
              <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-1 text-left cursor-pointer hover:bg-bg-2/60" onClick={() => go("roster", o.id)}>
                <span className="font-medium text-gold-bright">{o.name}</span>
                {o.eventType && <span className="rounded-sm border border-gold-dim px-1.5 text-xs text-gold">{o.eventType}</span>}
                <span className={`text-xs uppercase tracking-wider ${STATE_CLASS[o.state]}`}>{STATE_LABEL[o.state]}</span>
                {set?.operation?.id === o.id && <span className="text-xs text-net-party">your voice is here</span>}
                <span className="text-text-muted">{when(o.startsAt)}</span>
                {o.state !== "ended" && (o.coming ?? 0) > 0 && <span className="text-text-muted">{o.coming} coming</span>}
                <span className="text-text-muted ml-auto">Led by {o.leaderName}</span>
              </button>
              {o.canSignUp && (
                <div className="flex flex-wrap items-center gap-2 pb-1">
                  {o.mySignup == null && <span className="text-text-muted">Are you coming?</span>}
                  <SignupControl opId={o.id} status={o.mySignup ?? null} onDone={reload} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {creating && (
        <section className="panel p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="title title-rule flex-1 text-sm text-gold">
              {t("New operation")}
              <Help text={t("Plan an event: name it, pick who leads it and which clans take part. It is created as Planned, and its roster board opens so you can build parties.\nNothing changes for players until the event leader starts it.")} />
            </h2>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setCreating(false)}>Cancel</button>
          </div>
          <NewOperation
            onCreated={(id) => {
              setCreating(false);
              reload();
              go("roster", id);
            }}
          />
        </section>
      )}
    </div>
  );
}
