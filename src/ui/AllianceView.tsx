// For the alliance's owner and its admins: the alliance itself, its clans and
// who leads them, its players, admins and bans.

import { d, t } from "../words";
import { useState } from "react";
import { rpc, type AllianceView as AllianceData, type PlanState } from "../api";
import { DISCORD_HELP, DiscordSetup } from "./DiscordSetup";
import { CHAT_SETTINGS_HELP, ChatSettings } from "./ChatSettings";
import { TRANSLATE_SETTINGS_HELP, TranslateSettings } from "./Language";
import { QUICK_CALLS_HELP, QuickCalls } from "./QuickCalls";
import { PointsSettingsSection } from "./Points";
import { ItemsSection } from "./Loot";
import { GAME_SETUP_HELP, GameSetup } from "./GameSetup";
import { ConfirmButton, useAct, useApp, useLoad } from "./app-context";
import { InviteLinks } from "./ClanView";
import { SUPPORT_URL } from "../config";
import { ClanCrest, ClanMark, openInBrowser } from "./common";
import { Help } from "./tips";
import { AuditLog } from "./AuditLog";

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 flex flex-col gap-3">
      <h2 className="title title-rule text-sm text-gold">
        {title}
        {help && <Help text={help} />}
      </h2>
      {children}
    </section>
  );
}

/** The alliance itself: its name, its shared lounge, and for its owner, handing it on and deleting it. */
function AllianceSelf({
  alliance,
  plan,
  loungeOn,
  broadcastOn,
  users,
  owner,
  busy,
  call,
}: {
  alliance: { id: number; name: string };
  plan: PlanState | null;
  loungeOn: boolean;
  broadcastOn: boolean;
  users: { id: number; name: string; isOwner?: boolean }[];
  owner: boolean;
  busy: boolean;
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const { refreshInfo, go } = useApp();
  const [name, setName] = useState<string | null>(null);
  /** The player the owner has picked to hand the alliance to, until they confirm. */
  const [handTo, setHandTo] = useState<{ id: number; name: string } | null>(null);
  return (
    <Section
      title={alliance.name}
      help={t("Your alliance: the group that shares one roster. Everything on this screen belongs to it and to nobody else.\nShared lounge: one extra room, between events, that every clan of the alliance sits in together. Off, each clan has only its own lounge.\nAdmins' broadcast: between operations, the alliance's admins can speak to everyone in the alliance with their Broadcast key, over the lounges and groups, as an event leader does in an operation. Off by default.\nThe owner appoints the alliance's admins (in the list of players), can hand the alliance to another player, and can delete it.")}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3" data-alliance-self>
        {name === null ? (
          <button type="button" className="btn btn-quiet text-sm" onClick={() => setName(alliance.name)}>Rename</button>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void call("alliance.rename", { name }).then(() => {
                setName(null);
                refreshInfo();
              });
            }}
          >
            <input className="field w-64 py-0.5" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} required autoFocus aria-label={t("Alliance name")} />
            <button className="btn text-sm" disabled={busy}>Save</button>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setName(null)}>Cancel</button>
          </form>
        )}
        <span className="flex items-center gap-2">
          <span className="text-text-muted">
            Shared lounge is <span className={loungeOn ? "font-medium text-net-party" : "font-medium text-text"}>{loungeOn ? "on" : "off"}</span>
          </span>
          <ConfirmButton confirm={loungeOn ? "Turn off for everyone?" : t("Let every clan hear each other?")} disabled={busy} onConfirm={() => void call("alliance.setLounge", { on: !loungeOn })}>
            {loungeOn ? "Turn off" : "Turn on"}
          </ConfirmButton>
        </span>
        <span className="flex items-center gap-2" data-broadcast-switch>
          <span className="text-text-muted">
            {t("Admins' broadcast between operations is")}{" "}
            <span className={broadcastOn ? "font-medium text-net-party" : "font-medium text-text"}>{broadcastOn ? "on" : "off"}</span>
          </span>
          <ConfirmButton confirm={broadcastOn ? "Turn off for everyone?" : t("Let the admins speak to the whole alliance?")} disabled={busy} onConfirm={() => void call("alliance.setBroadcast", { on: !broadcastOn })}>
            {broadcastOn ? "Turn off" : "Turn on"}
          </ConfirmButton>
        </span>
        {owner && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <select
              className="field w-auto py-0.5 text-sm"
              value=""
              disabled={busy}
              aria-label={t("Hand the alliance to")}
              onChange={(e) => setHandTo(users.find((u) => u.id === Number(e.target.value)) ?? null)}
            >
              <option value="" disabled>Hand it to…</option>
              {users.filter((u) => !u.isOwner).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <ConfirmButton
              confirm={`Delete ${alliance.name} and everything in it?`}
              disabled={busy}
              onConfirm={() =>
                void call("alliance.delete", {}).then(() => {
                  refreshInfo();
                  go("clan");
                })
              }
            >
              {t("Delete alliance")}
            </ConfirmButton>
          </span>
        )}
        {plan && (
          <p className="flex w-full flex-wrap items-center gap-x-2 text-sm text-text-muted" data-plan>
            <span>
              {plan.label} plan: <span className={plan.members >= plan.cap ? "font-medium text-danger" : "text-text"}>{plan.members}</span> of {plan.cap} approved members
            </span>
            <Help text={t("How many approved members the alliance may have. At the limit nobody new can be approved, let straight in or moved in; nobody is removed and no voice is cut. During the beta every alliance is on the Beta plan and nothing is charged. For a larger limit, ask the service.")} />
            <button type="button" className="text-gold-bright underline-offset-2 hover:underline cursor-pointer" onClick={() => void openInBrowser(SUPPORT_URL)}>Ask on the Warcryer Discord</button>
            {plan.suspended && <span className="text-danger">{t("The service has paused this alliance's operations: none can be created or started. Members and lounges are untouched.")}</span>}
            {!plan.suspended && plan.over && <span className="text-danger">{t("Over the limit: no operation can be created or started until that is put right.")}</span>}
            {!plan.suspended && !plan.over && plan.members >= plan.cap && <span className="text-danger">At the limit: nobody new can be approved.</span>}
          </p>
        )}
        {handTo && (
          <span className="flex w-full flex-wrap items-center justify-end gap-2" role="status">
            <span className="text-gold">Make {handTo.name} the owner of {alliance.name}?</span>
            <span className="text-xs text-text-muted">You stay in it as an admin.</span>
            <button type="button" className="btn text-sm" disabled={busy} onClick={() => void call("alliance.transfer", { userId: handTo.id }).then(() => { setHandTo(null); refreshInfo(); })}>Hand over</button>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setHandTo(null)}>Cancel</button>
          </span>
        )}
      </div>
    </Section>
  );
}

export function AllianceView() {
  const { info, crests } = useApp();
  const { data, error, reload } = useLoad(() => rpc<AllianceData>("alliance.get"), []);
  const act = useAct();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [filter, setFilter] = useState("");
  /** The clan being renamed, with what has been typed so far. */
  const [renaming, setRenaming] = useState<{ id: number; name: string; tag: string } | null>(null);
  /** The clan whose invite links are open. */
  const [inviting, setInviting] = useState<number | null>(null);
  /** A move to another clan that is waiting to be confirmed. */
  const [moving, setMoving] = useState<{ userId: number; clanId: number } | null>(null);

  if (error && !data) return <p className="p-4 text-danger">{error}</p>;
  if (!data) return <p className="p-4 text-text-muted">Loading…</p>;

  const call = (method: string, params: Record<string, unknown>) => act.run(() => rpc(method, params)).then(reload);
  // The owner's tools: its admins, handing it on, deleting it. (The platform admin has them too, in an alliance they are in.)
  const owner = data.alliance?.role === "owner" || info.user.isAdmin;
  const eligible = data.users.filter((u) => !u.banned);
  const shown = data.users.filter((u) => u.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {act.error && <p className="text-danger" role="alert">{act.error}</p>}

      {data.alliance && <AllianceSelf alliance={data.alliance} loungeOn={!!data.loungeOn} broadcastOn={!!data.broadcastOn} users={data.users} owner={owner} busy={act.busy} call={call} plan={data.plan ?? null} />}

      <Section title={t("Clans")} help={t("Every player belongs to one clan, and voice follows it: a clan has its own lounge between operations and its own Clan net during them.\nRename changes a clan's name and tag; its members, constant parties, crest and invite links stay. Delete is offered once a clan is empty or has only its leader left.\nCreate the clan here, then appoint its leader. The leader approves members and appoints officers. Appointing a new leader makes the previous one an ordinary member.")}>
        {data.clans.length === 0 && <p className="text-text-muted">{t("No clans yet. Create the first one below, then appoint its leader.")}</p>}
        <ul className="flex flex-col divide-y divide-line">
          {data.clans.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
              <ClanCrest clanId={c.id} size={24} />
              {renaming?.id === c.id ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act.run(() => rpc("alliance.renameClan", { clanId: c.id, name: renaming.name, tag: renaming.tag })).then((ok) => {
                      if (ok) setRenaming(null);
                      reload();
                    });
                  }}
                >
                  <input className="field w-52 py-0.5" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} maxLength={48} required autoFocus aria-label={t("New clan name")} />
                  <input className="field w-24 py-0.5" value={renaming.tag} onChange={(e) => setRenaming({ ...renaming, tag: e.target.value })} maxLength={8} required aria-label="New tag" />
                  <button className="btn text-sm" disabled={act.busy}>Save</button>
                  <button type="button" className="btn btn-quiet text-sm" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="font-medium text-gold-bright">{c.name}</span>
                  <span className="text-text-muted">[{c.tag}]</span>
                  <button type="button" className="text-xs text-text-muted hover:text-gold-bright cursor-pointer" aria-label={`Rename ${c.name}`} onClick={() => setRenaming({ id: c.id, name: c.name, tag: c.tag })}>Rename</button>
                  {c.members <= 1 && (
                    <ConfirmButton className="text-xs text-text-muted hover:text-danger cursor-pointer" confirm={`Delete ${c.name} for good?`} disabled={act.busy} onConfirm={() => void call("alliance.deleteClan", { clanId: c.id })}>Delete</ConfirmButton>
                  )}
                </>
              )}
              <span className="text-text-muted">{c.leaderName ? `Led by ${c.leaderName}` : "No leader yet"} · {c.members} members</span>
              <button
                type="button"
                className="text-xs text-text-muted hover:text-gold-bright cursor-pointer"
                aria-expanded={inviting === c.id}
                aria-label={`Invite links for ${c.name}`}
                onClick={() => setInviting(inviting === c.id ? null : c.id)}
              >
                {inviting === c.id ? "Hide invite links" : "Invite links"}
              </button>
              {crests.has(c.id) && (
                <ConfirmButton className="ml-auto text-xs text-text-muted hover:text-danger cursor-pointer" confirm="Remove this crest?" disabled={act.busy} onConfirm={() => void call("clan.setCrest", { clanId: c.id, image: null })}>Remove crest</ConfirmButton>
              )}
              <select
                className={`field w-auto ${crests.has(c.id) ? "" : "ml-auto"}`}
                value=""
                disabled={act.busy}
                aria-label={`Leader of ${c.name}`}
                onChange={(e) => void call("alliance.appointLeader", { clanId: c.id, userId: Number(e.target.value) })}
              >
                <option value="" disabled>{c.leaderName ? "Change leader…" : "Appoint leader…"}</option>
                {eligible.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.clanTag ? ` [${u.clanTag}]` : ""}</option>
                ))}
              </select>
              {inviting === c.id && <InviteLinks clanId={c.id} inline />}
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act.run(() => rpc("alliance.createClan", { name, tag }))) {
              setName("");
              setTag("");
            }
            reload();
          }}
        >
          <label className="flex flex-col gap-1 text-text-muted">
            {t("Clan name")}
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} required />
          </label>
          <label className="flex flex-col gap-1 text-text-muted">
            <span className="flex items-center gap-1">
              Tag
              <Help text={t("A short form of the clan's name: 1 to 8 letters or digits, for example DRG for Dragons.\nIt is shown in brackets beside every member's name in voice and on roster boards, so callers can tell at a glance which clan a player is from. Once the clan's leader uploads a crest, the crest is shown there instead of the tag.\nIn an operation with several clans it also names each clan's own net, for example \"Clan DRG\".")} />
            </span>
            <input className="field w-28" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={8} required />
          </label>
          <button className="btn" disabled={act.busy}>{t("Create clan")}</button>
        </form>
        <p className="text-xs text-text-muted">{t("To bring in a clan's leader, open Invite links beside the clan, make a link and send it to them; once they have used it, appoint them here. A player in another clan has to be moved out of it first (Players, below). A clan can be deleted once only its leader is left in it.")}</p>
      </Section>

      <Section title={`Players (${data.users.length})`} help={t("Everyone in the alliance who has confirmed a name.\nOwner: started the alliance or was handed it; appoints its admins.\nAlliance admin: manages clans, clan leaders, operations and bans.\nMove to clan: puts the player straight into another clan as an approved member, without a request or an invite. Use it for a transfer. In the clan they leave, they lose their constant parties and their party places in operations still to come. A clan's leader has to be replaced before they can be moved.\nA ban puts the player out of the alliance at once, voice included. It follows their Discord account, so an invite link does not bring them back. Lift it from the list of bans below the players.")}>
        <input className="field max-w-xs" placeholder="Find a player" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a player" />
        <ul className="flex flex-col divide-y divide-line">
          {shown.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{u.name}</span>
              <span className="text-text-muted"><ClanMark clanId={u.clanId} tag={u.clanTag} size={18} /></span>
              {u.isOwner && <span className="text-xs uppercase tracking-wider text-gold">Owner</span>}
              {u.isAllianceAdmin && !u.isOwner && <span className="text-xs uppercase tracking-wider text-gold-dim">{t("Alliance admin")}</span>}
              {data.clans.some((c) => c.id !== u.clanId) && (
                <select
                  className="field ml-auto w-auto py-0.5 text-sm"
                  value=""
                  disabled={act.busy}
                  aria-label={t(`Move ${d(u.name)} to a clan`)}
                  onChange={(e) => setMoving({ userId: u.id, clanId: Number(e.target.value) })}
                >
                  <option value="" disabled>{u.clanId === null ? t("Put in a clan…") : t("Move to clan…")}</option>
                  {data.clans.filter((c) => c.id !== u.clanId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} [{c.tag}]</option>
                  ))}
                </select>
              )}
              {/* Offered only where the server would allow it; it checks again. */}
              {u.id !== info.user.id && !u.isOwner && (
                <span className={`flex items-center gap-2 ${data.clans.some((c) => c.id !== u.clanId) ? "" : "ml-auto"}`}>
                  {owner &&
                    (u.isAllianceAdmin ? (
                      <button type="button" className="btn btn-quiet text-sm" disabled={act.busy} onClick={() => void call("alliance.setAdmin", { userId: u.id, on: false })}>Remove admin</button>
                    ) : (
                      <button type="button" className="btn btn-quiet text-sm" disabled={act.busy} onClick={() => void call("alliance.setAdmin", { userId: u.id, on: true })}>Make admin</button>
                    ))}
                  {(!u.isAllianceAdmin || owner) && (
                    <ConfirmButton confirm={`Ban ${u.name}?`} disabled={act.busy} onConfirm={() => void call("alliance.setBanned", { userId: u.id, banned: true })}>Ban</ConfirmButton>
                  )}
                </span>
              )}
              {moving?.userId === u.id && (
                <span className="flex w-full flex-wrap items-center justify-end gap-2" role="status">
                  <span className="text-gold">Move {u.name} to {data.clans.find((c) => c.id === moving.clanId)?.name}?</span>
                  <button type="button" className="btn text-sm" disabled={act.busy} onClick={() => void call("alliance.moveToClan", { userId: u.id, clanId: moving.clanId }).then(() => setMoving(null))}>Move</button>
                  <button type="button" className="btn btn-quiet text-sm" onClick={() => setMoving(null)}>Cancel</button>
                  {u.clanId !== null && <span className="w-full text-right text-xs text-text-muted">{t("They leave their constant parties and their party places in operations still to come.")}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">{t("A ban puts the player out of the alliance at once, voice included, and keeps them out. It follows their Discord account.")}</p>
        {(data.bans?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1 border-t border-line pt-3" data-bans>
            <h3 className="text-xs uppercase tracking-wider text-danger">Banned ({data.bans?.length})</h3>
            <ul className="flex flex-col divide-y divide-line">
              {data.bans?.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-1.5">
                  <span className="text-text-muted line-through">{b.name}</span>
                  <span className="text-xs text-text-muted">since {new Date(b.at).toLocaleDateString()}</span>
                  <button type="button" className="btn btn-quiet ml-auto text-sm" disabled={act.busy} onClick={() => void call("alliance.liftBan", { banId: b.id })}>Lift ban</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Game setup" help={t(GAME_SETUP_HELP)}>
        <GameSetup />
      </Section>

      {data.discord !== undefined && (
        <Section title="Discord announcements" help={DISCORD_HELP(t("any operation of the alliance")) + t("\nEach clan's leader can also set up a channel of their own on the Clan screen, for the operations that clan takes part in.")}>
          <DiscordSetup clanId={null} connected={data.discord} role={data.discordRole} remind={data.remindMinutes === undefined ? undefined : { minutes: data.remindMinutes, choices: data.remindChoices ?? [0, 15, 30, 60, 120] }} onChange={reload} />
        </Section>
      )}

      {data.chat && (
        <Section title="Chat" help={t(CHAT_SETTINGS_HELP)}>
          <ChatSettings settings={data.chat} choices={data.chatKeepChoices ?? [0, 7, 30, 365]} onChange={reload} />
        </Section>
      )}

      {data.translate && (
        <Section title="Chat translation" help={t(TRANSLATE_SETTINGS_HELP)}>
          <TranslateSettings settings={data.translate} onChange={reload} />
        </Section>
      )}

      {data.calls && (
        <Section title="Quick calls" help={t(QUICK_CALLS_HELP)}>
          <QuickCalls calls={data.calls} limits={data.callLimits ?? { slots: 8, max: 40 }} onChange={reload} />
        </Section>
      )}

      <PointsSettingsSection clanId={null} />
      <ItemsSection clanId={null} />

      <AuditLog
        scope="alliance"
        title="Log"
        help={t("Who changed what, newest first: clans and their leaders, approvals and removals, invite links, constant parties, operations, every roster move, bans.\nA line that starts with The server is something done automatically, such as promoting a party's next member when its leader dropped out.\nAn account that has since been deleted shows as a deleted account.\nA clan's leader can read the part of this that concerns their own clan, on the Clan tab.")}
      />
    </div>
  );
}
