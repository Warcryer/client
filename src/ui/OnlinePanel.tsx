// Who in the alliance has the app open right now (decision 64, step 1b): in
// the lounge, in a group, in an operation, or away. The control service sends
// the list; nothing here is asked for. Shown under the nets between operations.
import { t } from "../words";
import type { PresenceEntry } from "../control";
import { useApp } from "./app-context";
import { ClanMark } from "./common";
import { Help } from "./tips";

// t() where shown.
const ONLINE_HELP = [
  "Everyone in your alliance who has the app open now, whatever their clan: in a lounge, in a group, in an operation, or away.",
  "Away is shown when someone says so with the switch here, or when their computer has had no key or mouse input for a quarter of an hour. It changes nothing about voice: an away player still hears and can be heard.",
  "Players of other alliances never see you here, and you never see them.",
].join("\n");

function Person({ p }: { p: PresenceEntry }) {
  return (
    <li className={`flex items-center gap-1.5 truncate ${p.away ? "text-text-muted" : ""}`} data-online={p.userId}>
      <span className="text-xs"><ClanMark clanId={p.clanId} tag={p.clanTag} size={14} /></span>
      <span className="truncate">{p.name}</span>
      {p.classTag && <span className="text-xs text-gold">{p.classTag}</span>}
    </li>
  );
}

export function OnlinePanel() {
  const { presence, awayByHand, setAwayByHand, away, info } = useApp();
  if (!presence) return null;
  const all = [...presence.values()].sort((a, b) => a.name.localeCompare(b.name));
  const here = all.filter((p) => !p.away && p.where === "lounge" && p.groupId === null);
  const grouped = all.filter((p) => !p.away && p.where === "lounge" && p.groupId !== null);
  const busy = all.filter((p) => !p.away && p.where === "operation");
  const gone = all.filter((p) => p.away);
  const section = (title: string, people: PresenceEntry[], key: string) =>
    people.length > 0 && (
      <div className="flex flex-col gap-0.5" data-online-section={key}>
        <h3 className="text-xs uppercase tracking-wider text-text-muted">
          {title} <span className="tabular-nums">{people.length}</span>
        </h3>
        <ul className="flex flex-col gap-0.5 text-sm">
          {people.map((p) => (
            <Person key={p.userId} p={p} />
          ))}
        </ul>
      </div>
    );
  return (
    <section className="panel flex min-h-0 flex-col gap-2 px-3 py-2" aria-label="Online" data-online-panel>
      <div className="flex items-center gap-2">
        <h2 className="title text-sm text-gold">Online</h2>
        <span className="text-xs tabular-nums text-text-muted">{all.length}</span>
        <Help text={t(ONLINE_HELP)} />
        <button
          type="button"
          className={`ml-auto cursor-pointer text-xs ${away ? "text-gold-bright" : "text-text-muted hover:text-gold"}`}
          onClick={() => setAwayByHand(!awayByHand)}
          aria-pressed={away}
          title={away && !awayByHand ? "Shown as away because the computer has been idle" : undefined}
          data-away-toggle
        >
          {away ? (awayByHand ? "I'm back" : "Away (idle)") : "Set me away"}
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {section(t("In the lounge"), here, "lounge")}
        {section("In a group", grouped, "group")}
        {section(t("In an operation"), busy, "operation")}
        {section("Away", gone, "away")}
        {all.length <= 1 && <p className="text-xs text-text-muted">{info.alliance ? t("Nobody else from your alliance has the app open right now.") : ""}</p>}
      </div>
    </section>
  );
}
