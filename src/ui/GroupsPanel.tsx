// Groups between operations (decision 64): small rooms anyone in the alliance
// starts or joins. Shown on the Voice tab while the player is in the lounge.
// What a group gives you to hear is decided by the server like every other
// net; this panel only starts, joins and leaves them.
import { useState } from "react";
import { t } from "../words";
import { rpc } from "../api";
import { useAct, useApp, useLoad } from "./app-context";
import { ClanMark } from "./common";
import { Help } from "./tips";

import type { GroupInfo } from "../control";

type GroupsView = { groups: GroupInfo[]; mine: number | null; limits: { perAlliance: number; perGroup: number; label: number } };
const LIMITS = { perAlliance: 50, perGroup: 50, label: 40 };

// t() where shown.
const GROUPS_HELP = [
  "A group is a small room for a few of you between operations: a dungeon, farming, crafting, or just a chat. Anyone in the alliance can start one, and anyone in the alliance can join it, whatever their clan.",
  "In a group your Party key and voice go to the group, and you still hear your clan's lounge underneath, quieter. Click Talk here on the lounge to speak there instead. How loud the lounge stays is in Settings.",
  "You are in one group at a time. A group ends when its last player leaves, or when none of its players has had the app open for ten minutes. A live operation still pulls you onto its nets, and you come back to your group when it ends.",
  "Click a group's row to see its players one by one. A clan's leader and officers can take their own members out of a group there, and the alliance's admins anyone. Nothing about a group is kept, and time in one counts for nothing.",
].join("\n");

export function GroupsPanel() {
  const act = useAct();
  const { groups: pushed, info, presence } = useApp();
  // Asked for once when the panel opens; after that the control service sends the list whenever it changes.
  const { data: loaded, error, reload } = useLoad(() => rpc<GroupsView>("groups.list"), [], 120_000);
  const [label, setLabel] = useState("");
  /** The group whose row is opened out: its players as cards, with the way to take one out. */
  const [openId, setOpenId] = useState<number | null>(null);
  const run = (method: string, params: Record<string, unknown> = {}) => void act.run(() => rpc(method, params)).then(() => !pushed && reload());

  const groups = pushed ?? loaded?.groups ?? null;
  if (!groups) return error ? <p className="text-sm text-danger">{error}</p> : null;
  const limits = loaded?.limits ?? LIMITS;
  const me = info.user.id;
  const mineId = groups.find((g) => g.members.some((m) => m.userId === me))?.id ?? null;
  // Who may take whom out: the server checks it again; this only decides where the × is shown.
  const leads = info.membership?.status === "active" && (info.membership.role === "leader" || info.membership.role === "officer") ? info.membership.clanId : null;
  const mayRemove = (m: GroupInfo["members"][number]) => m.userId !== me && (info.user.runsAlliance === true || (leads !== null && m.clanId === leads));
  const data = { groups, mine: mineId, limits };
  const full = data.groups.length >= data.limits.perAlliance;
  return (
    <section className="panel flex max-h-44 min-h-[5.25rem] flex-[0_1_auto] flex-col" aria-label="Groups" data-groups>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <h2 className="title text-sm text-net-party">Groups</h2>
        <Help text={t(GROUPS_HELP)} />
        <form
          className="ml-auto flex min-w-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("groups.start", { label: label.trim() });
            setLabel("");
          }}
        >
          <input
            className="field w-44 min-w-0 py-1 text-sm"
            value={label}
            maxLength={data.limits.label}
            placeholder="Name it (optional)"
            aria-label="Name for a new group"
            onChange={(e) => setLabel(e.target.value)}
            data-group-label
          />
          <button type="submit" className="btn shrink-0 whitespace-nowrap px-3 py-1 text-sm" disabled={act.busy || full} data-group-start>
            Start a group
          </button>
        </form>
      </div>
      {act.error && <p className="px-3 pt-2 text-sm text-danger" role="alert">{act.error}</p>}
      {data.groups.length === 0 ? (
        <p className="px-3 py-3 text-sm text-text-muted">{t("No groups yet. Start one for a dungeon, farming or a chat; anyone in the alliance can join it.")}</p>
      ) : (
        <ul className="flex min-h-0 flex-col divide-y divide-line overflow-y-auto">
          {data.groups.map((g) => {
            const mine = g.id === data.mine;
            const open = g.id === openId;
            const here = (m: GroupInfo["members"][number]) => !presence || presence.has(m.userId);
            const isAway = (m: GroupInfo["members"][number]) => presence?.get(m.userId)?.away === true;
            return (
              // One line per group: its name, how many, and their names as far as they fit. Opened out, the
              // players are cards. A row's height does not depend on how many are in the group.
              <li key={g.id} className={`flex shrink-0 flex-col ${mine ? "bg-bg-2" : ""}`} data-group={g.id} data-group-open={open ? "" : undefined}>
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-3 text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : g.id)} data-group-toggle>
                    <span className={`max-w-[45%] shrink-0 truncate font-medium ${mine ? "text-net-party" : "text-text"}`}>{g.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">{g.members.length}</span>
                    {!open && (
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text-muted">
                        {g.members.map((m) => (
                          <span key={m.userId} className={`mr-3 inline-flex items-baseline gap-1 ${here(m) ? "" : "opacity-50"}`} data-group-member={m.userId}>
                            <span className="text-xs"><ClanMark clanId={m.clanId} tag={m.clanTag} size={13} /></span>
                            <span className={isAway(m) ? "" : "text-text"}>{m.name}</span>
                            {isAway(m) && <span className="text-[11px]" data-group-away>away</span>}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-text-muted" aria-hidden>{open ? "▲" : "▼"}</span>
                  </button>
                  {mine ? (
                    <button type="button" className="btn btn-quiet shrink-0 px-3 py-0.5 text-sm" disabled={act.busy} onClick={() => run("groups.leave")} data-group-leave>
                      Leave
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn shrink-0 px-3 py-0.5 text-sm"
                      disabled={act.busy || g.members.length >= data.limits.perGroup}
                      onClick={() => run("groups.join", { groupId: g.id })}
                      data-group-join
                    >
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
    </section>
  );
}
