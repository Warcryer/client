// An operation's priority targets (server decision 73): the whole list, and the way to change it.
//
// In a mass fight each party, and sometimes one player, is given enemies to keep down. The list says
// who has which: every entry is an enemy's name given to everyone on the operation, to one clan, to
// one party or to one player. Every player reads their own at the top of the chat (TargetChips); this
// is where the organisers and the clans' leaders write the list, and where anyone can read all of it.
// It is shown on the roster board, and from the Voice screen as a dialog (`TargetsButton`), so that a
// leader can change a name in the middle of a fight without leaving that screen.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rpc, type TargetRow, type TargetsBoard } from "../api";
import { d, t } from "../words";
import { useAct, useLoad } from "./app-context";
import { copyText } from "./TargetChips";
import { Help } from "./tips";

// t() where shown.
const TARGETS_HELP = [
  "Enemies to keep down, by name. Each name is given to everyone on the operation, to one clan, to one party or to one player.",
  "Every player sees the names that apply to them at the top of the operation's chat, their own first, and hears a sound when they change. Clicking a name copies it, spelled as it is written here.",
  "The event leader, the deputies and the alliance's admins set any target. A clan's leader and officers set those of their own clan, its parties and its players.",
  "To add several names at once, divide them with commas.",
].join("\n");

/** Whom a target is for, as one word for a list: "all", "c3" (a clan), "p12" (a party), "u40" (a player). */
type Key = string;
const keyFor = (kind: "c" | "p" | "u", id: number | null): Key => kind + String(id);
const keyOf = (r: Pick<TargetRow, "scope" | "clanId" | "partyId" | "userId">): Key =>
  r.scope === "clan" ? keyFor("c", r.clanId) : r.scope === "party" ? keyFor("p", r.partyId) : r.scope === "player" ? keyFor("u", r.userId) : "all";
/** The same as the server is told it. */
const toOf = (key: Key) => {
  const id = Number(key.slice(1));
  return key[0] === "c" ? { scope: "clan", clanId: id } : key[0] === "p" ? { scope: "party", partyId: id } : key[0] === "u" ? { scope: "player", userId: id } : { scope: "all" };
};

type Group = { key: Key; label: string; /** A smaller word after the name: a clan's tag, a player's clan. */ tag: string | null; may: boolean; targets: TargetRow[] };

/** The list in groups: everyone, each clan, each party, then the players who have targets of their own. */
function groupsOf(data: TargetsBoard, showEmpty: boolean): Group[] {
  const by = new Map<Key, TargetRow[]>();
  for (const target of data.targets) by.set(keyOf(target), [...(by.get(keyOf(target)) ?? []), target]);
  const groups: Group[] = [{ key: "all", label: t("Everyone"), tag: null, may: data.may.all, targets: by.get("all") ?? [] }];
  for (const c of data.clans) groups.push({ key: keyFor("c", c.id), label: c.name, tag: c.tag, may: data.may.clanIds.includes(c.id), targets: by.get(keyFor("c", c.id)) ?? [] });
  for (const p of data.parties) groups.push({ key: keyFor("p", p.id), label: p.name, tag: null, may: data.may.partyIds.includes(p.id), targets: by.get(keyFor("p", p.id)) ?? [] });
  for (const p of data.people) {
    const own = by.get(keyFor("u", p.id));
    if (own) groups.push({ key: keyFor("u", p.id), label: p.name, tag: p.clanTag, may: data.may.userIds.includes(p.id), targets: own });
  }
  // A group with nothing in it is shown only where asked for, and only to someone who can put something there.
  return groups.filter((g) => g.targets.length > 0 || (showEmpty && g.may));
}

/** The choices of whom a new target is for: only those the viewer may give targets to. */
function ForSelect({ data, value, onChange, label, attr }: { data: TargetsBoard; value: Key; onChange: (key: Key) => void; label: string; attr?: string }) {
  const clans = data.clans.filter((c) => data.may.clanIds.includes(c.id));
  const parties = data.parties.filter((p) => data.may.partyIds.includes(p.id));
  const people = data.people.filter((p) => data.may.userIds.includes(p.id));
  return (
    <select className="field min-w-0 max-w-[12rem] py-1" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} {...(attr ? { [attr]: "" } : {})}>
      {data.may.all && <option value="all">{t("Everyone")}</option>}
      {clans.length > 0 && (
        <optgroup label={t("Clans")}>
          {clans.map((c) => <option key={c.id} value={keyFor("c", c.id)}>{c.name}</option>)}
        </optgroup>
      )}
      {parties.length > 0 && (
        <optgroup label={t("Parties")}>
          {parties.map((p) => <option key={p.id} value={keyFor("p", p.id)}>{p.name}</option>)}
        </optgroup>
      )}
      {people.length > 0 && (
        <optgroup label={t("Players")}>
          {people.map((p) => <option key={p.id} value={keyFor("u", p.id)}>{p.name}{p.clanTag ? ` [${p.clanTag}]` : ""}</option>)}
        </optgroup>
      )}
    </select>
  );
}

/** One name on the list. A reader clicks it to copy it; whoever may change it also gets "change" and "remove". */
function Entry({ opId, target, data, may, onChanged }: { opId: number; target: TargetRow; data: TargetsBoard; may: boolean; onChanged: () => void }) {
  const act = useAct();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(target.name);
  const [note, setNote] = useState(target.note ?? "");
  const [to, setTo] = useState<Key>(keyOf(target));
  const [copied, setCopied] = useState(false);
  const run = (method: string, params: Record<string, unknown>) =>
    void act.run(() => rpc(method, { opId, id: target.id, ...params })).then((ok) => {
      if (ok) {
        setEditing(false);
        onChanged();
      }
    });

  if (editing) {
    return (
      <li className="flex w-full flex-col gap-1 rounded-sm border border-gold-dim bg-bg-2 p-2" data-target-edit={target.name}>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("op.target.change", { name, note, ...toOf(to) });
          }}
        >
          <input className="field min-w-0 flex-1 py-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label={t("The target's name")} autoFocus spellCheck={false} autoComplete="off" />
          <input className="field min-w-0 flex-1 py-1" value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} placeholder={t("A few words, if you like")} aria-label={t("A few words about the target")} autoComplete="off" />
          <ForSelect data={data} value={to} onChange={setTo} label={t("Whom the target is for")} />
          <button type="submit" className="btn px-2 py-0.5 text-xs" disabled={act.busy || !name.trim()}>{t("Save")}</button>
          <button type="button" className="btn btn-quiet px-2 py-0.5 text-xs" disabled={act.busy} onClick={() => run("op.target.change", { first: true })} data-target-first>{t("Put first")}</button>
          <button type="button" className="cursor-pointer text-xs text-text-muted hover:text-gold" onClick={() => setEditing(false)}>{t("Cancel")}</button>
        </form>
        {act.error && <p className="text-xs text-danger" role="alert">{act.error}</p>}
      </li>
    );
  }
  return (
    <li className="inline-flex items-baseline gap-1 rounded-sm border border-danger/50 px-1.5" data-target-entry={target.name}>
      <button
        type="button"
        className="cursor-pointer break-all text-left font-semibold text-text hover:text-gold-bright"
        aria-label={t(`Copy the name ${d(target.name)}`)}
        onClick={() =>
          void copyText(target.name).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {target.name}
      </button>
      {target.note && <span className="text-xs text-text-muted">{target.note}</span>}
      {copied && <span className="text-[10px] uppercase tracking-wider text-gold">{t("copied")}</span>}
      {may && (
        <>
          <button type="button" className="cursor-pointer text-[11px] text-text-muted hover:text-gold" onClick={() => setEditing(true)} aria-label={t(`Change the target ${d(target.name)}`)} data-target-change>
            {t("change")}
          </button>
          <button type="button" className="cursor-pointer text-text-muted hover:text-danger" disabled={act.busy} onClick={() => run("op.target.remove", {})} aria-label={t(`Remove the target ${d(target.name)}`)} data-target-remove>
            ×
          </button>
        </>
      )}
      {act.error && <span className="text-xs text-danger" role="alert">{act.error}</span>}
    </li>
  );
}

/**
 * The list, with the line to add to it for those who may. `data` comes from the board (`op.get`) or
 * from `op.targets`; `onChanged` asks for it again after a change.
 */
export function TargetsBox({
  opId,
  data,
  onChanged,
  showEmpty = false,
}: {
  opId: number;
  data: TargetsBoard;
  onChanged: () => void;
  /** Also list the clans and parties that have no target yet, each with a "+": the leader's working list. Off on the board, which has its parties below. */
  showEmpty?: boolean;
}) {
  const act = useAct();
  const groups = groupsOf(data, showEmpty);
  const canAdd = data.open && (data.may.all || data.may.clanIds.length > 0 || data.may.partyIds.length > 0 || data.may.userIds.length > 0);
  const first: Key = data.may.all ? "all" : data.may.partyIds.length ? keyFor("p", data.may.partyIds[0]) : data.may.clanIds.length ? keyFor("c", data.may.clanIds[0]) : data.may.userIds.length ? keyFor("u", data.may.userIds[0]) : "all";
  const [to, setTo] = useState<Key | null>(null);
  const [names, setNames] = useState("");
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // The one chosen may have left the operation since: then the first choice stands in.
  const allowed = (key: Key) => {
    const id = Number(key.slice(1));
    return key === "all" ? data.may.all : key[0] === "c" ? data.may.clanIds.includes(id) : key[0] === "p" ? data.may.partyIds.includes(id) : data.may.userIds.includes(id);
  };
  const chosen = to !== null && allowed(to) ? to : first;
  const add = () =>
    void act.run(() => rpc("op.target.add", { opId, ...toOf(chosen), names, note })).then((ok) => {
      if (!ok) return;
      setNames("");
      setNote("");
      onChanged();
      input.current?.focus();
    });

  return (
    <div className="flex flex-col gap-2" data-targets>
      {canAdd && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (names.trim()) add();
          }}
          data-targets-add
        >
          <span className="text-xs text-text-muted">{t("For")}</span>
          <ForSelect data={data} value={chosen} onChange={setTo} label={t("Whom the target is for")} attr="data-targets-for" />
          <input
            ref={input}
            className="field min-w-[14rem] flex-[2] basis-56 py-1"
            value={names}
            maxLength={400}
            onChange={(e) => setNames(e.target.value)}
            placeholder={t("An enemy's name, or several with commas between")}
            aria-label={t("Names of the targets")}
            spellCheck={false}
            autoComplete="off"
            data-targets-names
          />
          <input className="field min-w-0 flex-1 basis-28 py-1" value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} placeholder={t("A few words, if you like")} aria-label={t("A few words about the target")} autoComplete="off" data-targets-note />
          <button type="submit" className="btn px-3 py-1 text-sm" disabled={act.busy || !names.trim()}>{t("Add")}</button>
        </form>
      )}
      {act.error && <p className="text-sm text-danger" role="alert">{act.error}</p>}
      {groups.every((g) => g.targets.length === 0) && <p className="text-sm text-text-muted" data-targets-none>{t("No targets have been set.")}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {groups.map((g) => (
          <li key={g.key} className="flex items-baseline gap-2 py-1" data-target-group={g.key}>
            <span className="w-32 shrink-0 truncate text-sm text-text-muted">
              {g.label}
              {g.tag && <span className="ml-1 text-[11px]">[{g.tag}]</span>}
            </span>
            <ul className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
              {g.targets.map((target) => <Entry key={`${target.id}|${target.name}|${target.note ?? ""}|${keyOf(target)}`} opId={opId} target={target} data={data} may={data.open && g.may} onChanged={onChanged} />)}
              {g.targets.length === 0 && <li className="text-xs text-text-muted">{t("none")}</li>}
            </ul>
            {data.open && g.may && (
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded-sm border border-line px-1.5 text-xs text-text-muted hover:border-gold-dim hover:text-gold"
                aria-label={t(`Add a target for ${d(g.label)}`)}
                onClick={() => {
                  setTo(g.key);
                  input.current?.focus();
                }}
                data-target-add
              >
                +
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The heading every place the list is shown gives it. */
export function TargetsTitle({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <h3 className="title text-sm text-gold">{t("Priority targets")}</h3>
      <Help text={t(TARGETS_HELP)} />
    </span>
  );
}

/** The list as a dialog over the Voice screen. It asks the server for the list itself, and again when anything on the roster changes. */
function TargetsDialog({ opId, onClose }: { opId: number; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => rpc<TargetsBoard>("op.targets", { opId }), [opId], 10_000);
  // Not inside a panel: a panel's blur would hold the dialog inside itself.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t("Priority targets")} onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-targets-dialog>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-sm border border-gold-dim bg-bg-1 p-4 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.7)]">
        <div className="flex items-center gap-2">
          <TargetsTitle />
          <button type="button" className="ml-auto cursor-pointer text-xs text-text-muted hover:text-gold" onClick={onClose} data-targets-close>
            {t("Close")}
          </button>
        </div>
        {error && !data && <p className="text-danger">{error}</p>}
        {!data && !error && <p className="text-text-muted">{t("Loading…")}</p>}
        {data && <TargetsBox opId={opId} data={data} onChanged={reload} showEmpty />}
      </div>
    </div>,
    document.body,
  );
}

/** A button that opens the operation's list of targets over the screen it is on. */
export function TargetsButton({ opId, className = "btn btn-quiet py-1 text-sm" }: { opId: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog" data-targets-open>
        {t("Targets")}
      </button>
      {open && <TargetsDialog opId={opId} onClose={() => setOpen(false)} />}
    </>
  );
}
