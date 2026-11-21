// Groups between operations (decision 64): small rooms anyone in the alliance
// starts or joins. Shown on the Voice tab while the player is in the lounge.
// What a group gives you to hear is decided by the server like every other
// net; this panel only starts, joins and leaves them.
import { useState } from "react";
import { t } from "../words";
import { rpc } from "../api";
import { useAct, useLoad } from "./app-context";
import { ClanMark } from "./common";
import { Help } from "./tips";

type GroupMember = { userId: number; name: string; classTag: string | null; clanId: number | null; clanTag: string | null; mayRemove: boolean };
type Group = { id: number; label: string; name: string; starterId: number | null; members: GroupMember[] };
type GroupsView = { groups: Group[]; mine: number | null; limits: { perAlliance: number; perGroup: number; label: number } };

// t() where shown.
const GROUPS_HELP = [
  "A group is a small room for a few of you between operations: a dungeon, farming, crafting, or just a chat. Anyone in the alliance can start one, and anyone in the alliance can join it, whatever their clan.",
  "In a group your Party key and voice go to the group, and you still hear your clan's lounge underneath, quieter. Click Talk here on the lounge to speak there instead. How loud the lounge stays is in Settings.",
  "You are in one group at a time. A group ends when its last player leaves, or when none of its players has had the app open for ten minutes. A live operation still pulls you onto its nets, and you come back to your group when it ends.",
  "A clan's leader and officers can take their own members out of a group, and the alliance's admins anyone. Nothing about a group is kept, and time in one counts for nothing.",
].join("\n");

export function GroupsPanel() {
  const act = useAct();
  const { data, error, reload } = useLoad(() => rpc<GroupsView>("groups.list"), [], 15_000);
  const [label, setLabel] = useState("");
  const run = (method: string, params: Record<string, unknown> = {}) => void act.run(() => rpc(method, params)).then(reload);

  if (!data) return error ? <p className="text-sm text-danger">{error}</p> : null;
  const full = data.groups.length >= data.limits.perAlliance;
  return (
    <section className="panel flex max-h-72 shrink-0 flex-col" aria-label="Groups" data-groups>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <h2 className="title text-sm text-net-party">Groups</h2>
        <Help text={t(GROUPS_HELP)} />
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("groups.start", { label: label.trim() });
            setLabel("");
          }}
        >
          <input
            className="field w-44 py-1 text-sm"
            value={label}
            maxLength={data.limits.label}
            placeholder="Name it (optional)"
            aria-label="Name for a new group"
            onChange={(e) => setLabel(e.target.value)}
            data-group-label
          />
          <button type="submit" className="btn px-3 py-1 text-sm" disabled={act.busy || full} data-group-start>
            Start a group
          </button>
        </form>
      </div>
      {act.error && <p className="px-3 pt-2 text-sm text-danger" role="alert">{act.error}</p>}
      {data.groups.length === 0 ? (
        <p className="px-3 py-3 text-sm text-text-muted">{t("No groups yet. Start one for a dungeon, farming or a chat; anyone in the alliance can join it.")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-y-auto">
          {data.groups.map((g) => {
            const mine = g.id === data.mine;
            return (
              <li key={g.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${mine ? "bg-bg-2" : ""}`} data-group={g.id}>
                <span className={`font-medium ${mine ? "text-net-party" : "text-text"}`}>{g.name}</span>
                <span className="text-xs tabular-nums text-text-muted">{g.members.length}</span>
                <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm">
                  {g.members.map((m) => (
                    <li key={m.userId} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5" data-group-member={m.userId}>
                      <span className="text-xs"><ClanMark clanId={m.clanId} tag={m.clanTag} size={14} /></span>
                      <span>{m.name}</span>
                      {m.classTag && <span className="text-xs text-gold">{m.classTag}</span>}
                      {m.mayRemove && (
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
                {mine ? (
                  <button type="button" className="btn btn-quiet px-3 py-1 text-sm" disabled={act.busy} onClick={() => run("groups.leave")} data-group-leave>
                    Leave
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn px-3 py-1 text-sm"
                    disabled={act.busy || g.members.length >= data.limits.perGroup}
                    onClick={() => run("groups.join", { groupId: g.id })}
                    data-group-join
                  >
                    Join
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
