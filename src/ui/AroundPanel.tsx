// The right-hand side of the Voice screen between operations (server decision
// 65): the alliance right now. Its groups, to start, join or leave one, and
// under them everyone else who has the app open: in a lounge, in an operation,
// away. Groups and Online were two panels that listed the same players; here a
// player is in one place, the group they sit in or the list of those in none.
// What a group gives you to hear is decided by the server like every other
// net; this panel only starts, joins and leaves them. The control service
// sends both lists whenever they change; nothing here asks for them again.

import { useState } from "react";
import { t } from "../words";
import { rpc } from "../api";
import type { GroupInfo, PresenceEntry } from "../control";
import { useAct, useApp, useLoad } from "./app-context";
import { ClanMark } from "./common";
import { WherePicker } from "./OperationPanel";
import { Help } from "./tips";

type GroupsView = { groups: GroupInfo[]; mine: number | null; limits: { perAlliance: number; perGroup: number; label: number } };
const LIMITS = { perAlliance: 50, perGroup: 50, label: 40 };

// t() where shown.
const AROUND_HELP = [
  "Your alliance right now: its groups, and everyone else who has the app open, whatever their clan. Players of other alliances never see you here, and you never see them.",
  "A group is a small room for a few of you between operations: a dungeon, farming, crafting, or just a chat. Anyone in the alliance can start one, and anyone in the alliance can join it.",
  "In a group your Party key and voice go to the group, and you still hear your clan's lounge underneath, quieter. Click Talk here on the lounge to speak there instead. How loud the lounge stays is in Settings.",
  "You are in one group at a time. A group ends when its last player leaves, or when none of its players has had the app open for ten minutes. A live operation still pulls you onto its nets, and you come back to your group when it ends.",
  "Click a group's line to see its players one by one. A clan's leader and officers can take their own members out of a group there, and the alliance's admins anyone. Nothing about a group is kept, and time in one counts for nothing.",
  "Away is shown when someone says so with the switch here, or when their computer has had no key or mouse input for a quarter of an hour. It changes nothing about voice: an away player still hears and can be heard.",
].join("\n");

/** A heading that stays in sight while its list scrolls under it, and folds the list away on a click. */
function Heading({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-line bg-bg-1 px-3 py-1">
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" aria-expanded={open} onClick={onToggle}>
        <h3 className="truncate text-xs uppercase tracking-wider text-text-muted">
          {title} <span className="tabular-nums">{count}</span>
        </h3>
        <span className="text-[9px] text-text-muted" aria-hidden>{open ? "▼" : "▶"}</span>
      </button>
      {children}
    </div>
  );
}

function Person({ p }: { p: PresenceEntry }) {
  return (
    <li className={`flex items-center gap-1.5 truncate ${p.away ? "text-text-muted" : ""}`} data-online={p.userId}>
      <span className="text-xs"><ClanMark clanId={p.clanId} tag={p.clanTag} size={14} /></span>
      <span className="truncate">{p.name}</span>
      {p.classTag && <span className="text-xs text-gold">{p.classTag}</span>}
    </li>
  );
}

export function AroundPanel() {
  const act = useAct();
  const { groups: pushed, info, presence, awayByHand, setAwayByHand, away, set } = useApp();
  // Asked for once when the panel opens; after that the control service sends the list whenever it changes.
  const { data: loaded, error, reload } = useLoad(() => rpc<GroupsView>("groups.list"), [], 120_000);
  const [label, setLabel] = useState("");
  /** The group whose line is opened out: its players as cards, with the way to take one out. */
  const [openId, setOpenId] = useState<number | null>(null);
  /** Lists folded away by the player. */
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());
  const flip = (key: string) => setShut((had) => { const next = new Set(had); if (!next.delete(key)) next.add(key); return next; });
  const run = (method: string, params: Record<string, unknown> = {}) => void act.run(() => rpc(method, params)).then(() => !pushed && reload());

  const groups = pushed ?? loaded?.groups ?? null;
  const limits = loaded?.limits ?? LIMITS;
  const me = info.user.id;
  const mineId = groups?.find((g) => g.members.some((m) => m.userId === me))?.id ?? null;
  // Your own group first: it is the one you look for.
  const listed = groups ? [...groups].sort((a, b) => Number(b.id === mineId) - Number(a.id === mineId)) : [];
  // Who may take whom out: the server checks it again; this only decides where the × is shown.
  const leads = info.membership?.status === "active" && (info.membership.role === "leader" || info.membership.role === "officer") ? info.membership.clanId : null;
  const mayRemove = (m: GroupInfo["members"][number]) => m.userId !== me && (info.user.runsAlliance === true || (leads !== null && m.clanId === leads));
  const full = listed.length >= limits.perAlliance;
  const here = (m: GroupInfo["members"][number]) => !presence || presence.has(m.userId);
  const isAway = (m: GroupInfo["members"][number]) => presence?.get(m.userId)?.away === true;

  const all = presence ? [...presence.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const lounge = all.filter((p) => !p.away && p.where === "lounge" && p.groupId === null);
  const busy = all.filter((p) => !p.away && p.where === "operation");
  const gone = all.filter((p) => p.away);
  const people = (title: string, list: PresenceEntry[], key: string) =>
    list.length > 0 && (
      <div data-online-section={key}>
        <Heading title={title} count={list.length} open={!shut.has(key)} onToggle={() => flip(key)} />
        {!shut.has(key) && (
          <ul className="flex flex-col gap-0.5 px-3 py-1.5 text-sm">
            {list.map((p) => (
              <Person key={p.userId} p={p} />
            ))}
          </ul>
        )}
      </div>
    );

  return (
    <section className="panel flex min-h-0 flex-1 flex-col" aria-label={t("Your alliance now")} data-around data-online-panel>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <h2 className="title min-w-0 truncate text-[13px] tracking-[0.1em] text-gold">{t("Alliance")}</h2>
        {presence && (
          <span className="whitespace-nowrap text-xs tabular-nums text-text-muted" aria-label={`${all.length} online`} data-online-count>
            {all.length}
            <span className="hidden xl:inline"> online</span>
          </span>
        )}
        <Help text={t(AROUND_HELP)} />
        {presence && (
          <button
            type="button"
            className={`ml-auto shrink-0 cursor-pointer whitespace-nowrap text-xs ${away ? "text-gold-bright" : "text-text-muted hover:text-gold"}`}
            onClick={() => setAwayByHand(!awayByHand)}
            aria-pressed={away}
            title={away && !awayByHand ? "Shown as away because the computer has been idle" : undefined}
            data-away-toggle
          >
            {away ? (awayByHand ? "I'm back" : "Away (idle)") : "Set me away"}
          </button>
        )}
      </div>
      {/* With operations on the list: where the player is, to form up early or come back from sitting one out. */}
      {set && set.operations.length > 0 && (
        <div className="shrink-0 border-b border-line px-3 py-2">
          <WherePicker />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {groups ? (
          <div data-groups>
            <Heading title="Groups" count={listed.length} open={!shut.has("groups")} onToggle={() => flip("groups")} />
            {!shut.has("groups") && (
              <>
                <form
                  className="flex items-center gap-2 px-3 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run("groups.start", { label: label.trim() });
                    setLabel("");
                  }}
                >
                  <input
                    className="field min-w-0 flex-1 py-1 text-sm"
                    value={label}
                    maxLength={limits.label}
                    placeholder="Name it (optional)"
                    aria-label="Name for a new group"
                    onChange={(e) => setLabel(e.target.value)}
                    data-group-label
                  />
                  <button type="submit" className="btn shrink-0 whitespace-nowrap px-2.5 py-1 text-sm" disabled={act.busy || full} data-group-start>
                    Start a group
                  </button>
                </form>
                {act.error && <p className="px-3 pb-2 text-sm text-danger" role="alert">{act.error}</p>}
                {listed.length === 0 ? (
                  <p className="px-3 pb-3 text-sm text-text-muted">{t("No groups yet. Start one for a dungeon, farming or a chat; anyone in the alliance can join it.")}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line border-t border-line">
                    {listed.map((g) => {
                      const mine = g.id === mineId;
                      const open = g.id === openId;
                      return (
                        // Two lines per group whatever its size: its name, then how many and who as far as it fits.
                        // Opened out, its players are cards.
                        <li key={g.id} className={`flex flex-col ${mine ? "bg-bg-2" : ""}`} data-group={g.id} data-group-open={open ? "" : undefined}>
                          <div className="flex items-center gap-2 px-3 py-1.5">
                            <button type="button" className="flex min-w-0 flex-1 cursor-pointer flex-col text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : g.id)} data-group-toggle>
                              <span className={`truncate font-medium ${mine ? "text-net-party" : "text-text"}`}>{g.name}</span>
                              <span className="truncate text-xs text-text-muted">
                                <span className="tabular-nums">{g.members.length}</span>
                                {mine && !open && <span> · you are here</span>}
                                {!open &&
                                  g.members.map((m, i) => (
                                    <span key={m.userId} className={here(m) ? "" : "opacity-50"} data-group-member={m.userId}>
                                      {i === 0 ? " · " : ", "}
                                      {m.name}
                                      {isAway(m) && <span data-group-away> (away)</span>}
                                    </span>
                                  ))}
                              </span>
                            </button>
                            {mine ? (
                              <button type="button" className="btn btn-quiet shrink-0 px-2.5 py-0.5 text-sm" disabled={act.busy} onClick={() => run("groups.leave")} data-group-leave>
                                Leave
                              </button>
                            ) : (
                              <button type="button" className="btn shrink-0 px-2.5 py-0.5 text-sm" disabled={act.busy || g.members.length >= limits.perGroup} onClick={() => run("groups.join", { groupId: g.id })} data-group-join>
                                Join
                              </button>
                            )}
                          </div>
                          {open && (
                            <ul className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-sm">
                              {g.members.map((m) => (
                                <li
                                  key={m.userId}
                                  className={`flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 ${here(m) ? "" : "opacity-50"}`}
                                  title={here(m) ? undefined : `${m.name} does not have the app open`}
                                  data-group-member={m.userId}
                                >
                                  <span className="text-xs"><ClanMark clanId={m.clanId} tag={m.clanTag} size={14} /></span>
                                  <span className={isAway(m) ? "text-text-muted" : ""}>{m.name}</span>
                                  {isAway(m) && <span className="text-[11px] text-text-muted" data-group-away>away</span>}
                                  {m.classTag && <span className="text-xs text-gold">{m.classTag}</span>}
                                  {mayRemove(m) && (
                                    <button
                                      type="button"
                                      className="ml-0.5 cursor-pointer text-text-muted hover:text-danger"
                                      aria-label={`Take ${m.name} out of the group`}
                                      title={`Take ${m.name} out of the group`}
                                      disabled={act.busy}
                                      onClick={() => run("groups.remove", { userId: m.userId })}
                                      data-group-remove
                                    >
                                      ×
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        ) : (
          error && <p className="px-3 py-2 text-sm text-danger">{error}</p>
        )}
        {people(t("In the lounge"), lounge, "lounge")}
        {people(t("In an operation"), busy, "operation")}
        {people("Away", gone, "away")}
        {presence && all.length <= 1 && <p className="px-3 py-2 text-xs text-text-muted">{info.alliance ? t("Nobody else from your alliance has the app open right now.") : ""}</p>}
      </div>
    </section>
  );
}
