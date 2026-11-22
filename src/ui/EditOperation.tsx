// Changing an operation after it was created: its name and start time (the
// event leader or an alliance admin), its event leader and clans (an alliance
// admin; the clans only before it starts), and deleting one planned by mistake.

import { d, t } from "../words";

import { useState } from "react";
import { rpc, type OpOptions, type OpView } from "../api";
import { useGame } from "../game";
import { ConfirmButton, useAct, useApp, useLoad } from "./app-context";
import { ClanCrest } from "./common";
import { Help } from "./tips";

/** An ISO time as the value a datetime-local field takes: the same moment in the player's own time zone. */
const localValue = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function EditOperation({ op, onClose, onSaved, onDeleted }: { op: OpView; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const { info } = useApp();
  const admin = info.user.runsAlliance;
  const planned = op.state === "planned";
  // The lists of clans and players are an alliance admin's to see, as when creating one.
  const { data } = useLoad(() => (admin ? rpc<OpOptions>("op.options") : Promise.resolve(null)), [admin], 600_000);
  const [name, setName] = useState(op.name);
  const [eventType, setEventType] = useState(op.eventType ?? "");
  const game = useGame();
  // The kind it has stays on offer even if the alliance has since taken it off its list.
  const kinds = [...new Set([...(game?.eventTypes ?? []), ...(op.eventType ? [op.eventType] : [])])];
  const [starts, setStarts] = useState(() => localValue(op.startsAt));
  const [leader, setLeader] = useState(op.eventLeaderId);
  const [clanIds, setClanIds] = useState(() => op.clans.map((c) => c.id));
  const act = useAct();
  const leaving = op.clans.filter((c) => !clanIds.includes(c.id));

  return (
    <form
      className="panel flex flex-col gap-3 p-3"
      data-edit-op
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await act.run(() =>
          rpc("op.update", {
            opId: op.id,
            name,
            eventType,
            startsAt: starts ? new Date(starts).toISOString() : "",
            ...(admin && data ? { eventLeaderId: leader, ...(planned ? { clanIds } : {}) } : {}),
          }),
        );
        if (ok) onSaved();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-text-muted">
          {t("Name")}
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        {kinds.length > 0 && (
          <label className="flex flex-col gap-1 text-text-muted">
            {t("Kind of event")}
            <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value)} aria-label={t("Kind of event")}>
              <option value="">{t("Not said")}</option>
              {kinds.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-text-muted">
          <span className="flex items-center gap-1">
            {t("Starts (your local time)")}
            <Help text={t("Each player sees the start in their own local time. Clear the field for no start time.\nThe operation does not start by itself: the event leader presses Start operation.")} />
          </span>
          <input type="datetime-local" className="field" value={starts} onChange={(e) => setStarts(e.target.value)} aria-label={t("Starts")} />
        </label>
        {admin && data && (
          <label className="flex flex-col gap-1 text-text-muted">
            {t("Event leader")}
            <select className="field" value={leader} onChange={(e) => setLeader(Number(e.target.value))} aria-label={t("Event leader")}>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}{u.clanTag ? ` [${u.clanTag}]` : ""}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {admin && data && planned && (
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="mb-1 flex items-center gap-1 text-text-muted">
            {t("Clans taking part")}
            <Help text={t("Tick a clan to add its members to this operation's roster; they are then asked whether they are coming.\nUntick a clan to take it out: its members leave the operation's parties and their answers are dropped. Organisers stay.\nThe clans can only be changed before the operation starts.")} />
          </legend>
          {data.clans.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input type="checkbox" checked={clanIds.includes(c.id)} onChange={(e) => setClanIds(e.target.checked ? [...clanIds, c.id] : clanIds.filter((x) => x !== c.id))} />
              <ClanCrest clanId={c.id} size={16} />
              {c.name} [{c.tag}]
            </label>
          ))}
        </fieldset>
      )}
      {leaving.length > 0 && (
        <p className="text-gold" role="status">
          {t(`Taking out ${d(leaving.map((c) => c.name).join(", "))}: its members leave this operation's parties.`)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={act.busy || name.trim().length < 2 || clanIds.length === 0}>{t("Save changes")}</button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>{t("Cancel")}</button>
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
        {planned && (
          <span className="ml-auto flex items-center gap-1">
            <ConfirmButton
              confirm={t("Delete it for good?")}
              disabled={act.busy}
              onConfirm={() => void act.run(() => rpc("op.delete", { opId: op.id })).then((ok) => ok && onDeleted())}
            >
              {t("Delete operation")}
            </ConfirmButton>
            <Help text={t("Removes this operation with its parties and answers, for one created by mistake. It cannot be undone.\nAn operation that has started cannot be deleted here: end it, and an alliance admin can delete it afterwards.")} />
          </span>
        )}
      </div>
    </form>
  );
}
