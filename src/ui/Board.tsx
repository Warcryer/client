// The roster board. Dragging a card, or selecting it and choosing a
// destination, moves the player; the roster is the routing table, so this is
// also what re-routes their audio. Permissions here only decide what is
// offered: the server checks every move again.

import { d, t } from "../words";
import { useState } from "react";
import { rpc, type CpPlaced, type OpDetail, type Party, type Person, type TargetsBoard } from "../api";
import { partySizeOf, roleOf, useGame } from "../game";
import { ConfirmButton, useAct, useApp, useLoad } from "./app-context";
import { AttendancePanel } from "./Attendance";
import { ChatRecord } from "./ChatRecord";
import { OpPoints } from "./Points";
import { OpLoot } from "./Loot";
import { EditOperation } from "./EditOperation";
import { when } from "./RosterView";
import { ClanCrest, ClanMark, STATE_LABEL } from "./common";
import { tn, tx } from "../i18n";
import { CharacterLine } from "./MyCharacters";
import { SignupControl } from "./Signup";
import { Help } from "./tips";
import { TargetsBox, TargetsTitle } from "./Targets";

/** What the marks on a player's card mean, shown behind the board's help icon. */
const legend = (PARTY_SIZE: number, needs: string[]) => [
  t("Green dot: the player has the app open."),
  t("✓: the player has said they are coming. Out: they have said they cannot come. Neither: no answer yet."),
  t("Beside the name: class and level. A second name in brackets is the player's usual name, when they bring another character to this event."),
  t("+2 and the like: how many boxes the player has listed, characters they can play at the same time as their main. Click a card to read all of that player's other characters."),
  t("♛ Lead: the event leader. Speaks on Broadcast and Command, starts and ends the operation."),
  t("Deputy: speaks on Broadcast and Command, and can move anyone."),
  t("⚑ Clan: a clan leader. Speaks on Clan and Command."),
  t("Officer: a clan officer. Speaks on Clan."),
  t("» PL: the party's leader. On Command for this party, and answers requests to join it."),
  t(`The usual party size is ${d(PARTY_SIZE)}. Going over is allowed.`),
  t(`Full: the party has ${d(PARTY_SIZE)} players who have not said they cannot come. Not ready: it has fewer.`),
  needs.length ? t(`Needs: the roles the party has nobody for yet (${d(needs.join(", ").toLowerCase())}), worked out from its players' classes. A player who cannot come is not counted.`) : "",
  t("Group type: what the party is for, such as a mage or a stopper group."),
  t("Ask to join: the party's leader gets your request and accepts or declines."),
].filter(Boolean).join("\n");
const STATE_CLASS = { live: "text-net-party", planned: "text-gold", ended: "text-text-muted" } as const;

export function Board({ opId, onBack }: { opId: number; onBack: () => void }) {
  const { info, set, select, refreshInfo } = useApp();
  const me = info.user.id;
  // Other organisers edit the same board, so reload often as well as on every change notice.
  const { data, error, reload } = useLoad(() => rpc<OpDetail>("op.get", { opId }), [opId], 5000);
  const act = useAct();
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | "reserve" | null>(null);
  const [placed, setPlaced] = useState("");
  const game = useGame();
  const PARTY_SIZE = partySizeOf(game);
  const LEGEND = legend(PARTY_SIZE, game?.partyNeeds ?? []);
  const [editing, setEditing] = useState(false);
  /** Reserve shows only this role when set. */
  const [role, setRole] = useState("");

  if (error && !data) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <p className="text-danger">{error}</p>
        <div><button type="button" className="btn btn-quiet" onClick={onBack}>{t("Back to operations")}</button></div>
      </div>
    );
  }
  if (!data) return <p className="p-4 text-text-muted">{t("Loading…")}</p>;

  const { op, perms, canRunOp } = data;
  const open = op.state !== "ended";
  const online = new Set(data.onlineIds);
  const person = new Map(op.people.map((p) => [p.userId, p]));
  const partyOf = (userId: number) => op.parties.find((p) => p.memberIds.includes(userId)) ?? null;
  // The priority targets, with the names the list needs taken from the board itself. A server before 0.42 sends none.
  const targetsData: TargetsBoard | null = data.targets
    ? { ...data.targets, parties: op.parties.map((p) => ({ id: p.id, name: p.name })), clans: op.clans, people: op.people.map((p) => ({ id: p.userId, name: p.name, clanTag: p.clanTag })) }
    : null;
  const canTarget = !!targetsData && targetsData.open && (targetsData.may.all || targetsData.may.clanIds.length > 0 || targetsData.may.partyIds.length > 0 || targetsData.may.userIds.length > 0);

  // Who is coming, and as which character: a sign-up may name another character than the profile's.
  const signup = new Map((op.signups ?? []).map((x) => [x.userId, x]));
  const shown = (p: Person) => {
    const x = signup.get(p.userId);
    return {
      name: x?.charName ?? p.name,
      usual: x?.charName ? p.name : null,
      tag: x?.className ? x.classTag : p.classTag,
      className: x?.className ?? p.className ?? null,
      band: x?.levelBand ?? p.levelBand ?? null,
      status: x?.status ?? null,
      note: x?.note ?? null,
    };
  };
  // What each party still lacks. A member who has said they cannot come fills no place.
  const wanted = game?.partyNeeds ?? [];
  const stateOf = (party: Party) => {
    const have = new Set<string>();
    let able = 0;
    let noClass = 0;
    for (const id of party.memberIds) {
      const p = person.get(id);
      if (!p) continue;
      const c = shown(p);
      if (c.status === "out") continue;
      able++;
      const r = roleOf(game, c.className);
      if (r) have.add(r);
      else if (!c.className) noClass++;
    }
    return { able, noClass, missing: wanted.filter((r) => !have.has(r)) };
  };
  const full = op.parties.filter((p) => stateOf(p).able >= PARTY_SIZE).length;
  const answers = { coming: 0, out: 0 };
  for (const x of op.signups ?? []) answers[x.status]++;
  const signCp = (cpId: number) => {
    setPlaced("");
    void act
      .run(async () => {
        const r = await rpc<{ added: number; kept: number }>("op.signupCp", { opId, cpId });
        setPlaced(t(`Signed up ${d(r.added)} ${r.added === 1 ? "member" : "members"}.${d(r.kept > 0 ? ` ${r.kept} had already answered and keep their own answer.` : "")}`));
      })
      .then(reload);
  };

  // Constant parties that can still be dropped onto this board.
  const offered = (data.cps ?? []).filter((cp) => !cp.onBoard && cp.members > 0);
  const addCps = (cpId: number | null) => {
    setPlaced("");
    void act
      .run(async () => {
        const r = await rpc<CpPlaced>("op.addCps", { opId, cpId });
        if (r.skipped.length > 0) setPlaced(t(`Already in another party, left where they are: ${d(r.skipped.join(", "))}.`));
      })
      .then(() => {
        reload();
        refreshInfo();
      });
  };

  const run = (method: string, params: Record<string, unknown>) => {
    void act.run(() => rpc(method, { opId, ...params })).then(() => {
      reload();
      refreshInfo();
    });
  };

  const overOwnClan = (p: Person) => p.clanId !== null && perms.leadClanIds.includes(p.clanId);
  /** May the viewer place this player in any party? */
  const canPlace = (p: Person) => open && (perms.isOrganiser || overOwnClan(p));
  /** May the viewer at least send this player to Reserve? */
  const canKick = (p: Person) => open && (canPlace(p) || partyOf(p.userId)?.leaderId === me);
  /** A party the viewer's clan may arrange: led by one of its own members, or with no leader yet. Organisers may arrange any. */
  const ours = (party: Party) => {
    if (perms.isOrganiser || party.leaderId === null) return true;
    const leader = person.get(party.leaderId);
    return !!leader && overOwnClan(leader);
  };
  const canLead = (p: Person, party: Party) => open && (perms.isOrganiser || (overOwnClan(p) && ours(party)) || party.leaderId === me);

  const move = (userId: number, partyId: number | null) => {
    if ((partyOf(userId)?.id ?? null) === partyId) return;
    run("op.move", { userId, partyId });
    setSelected(null);
  };
  const drop = (target: number | null) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const p = dragging === null ? undefined : person.get(dragging);
    setDragging(null);
    const to = target === null ? null : op.parties.find((x) => x.id === target);
    if (p && (to ? canPlace(p) && ours(to) : target === null && canKick(p))) move(p.userId, target);
  };
  const allow = (target: number | "reserve") => (e: React.DragEvent) => {
    if (dragging === null) return;
    e.preventDefault();
    setOver(target);
  };

  // Asking to join: for players who cannot simply place themselves.
  const self = person.get(me);
  const canAsk = open && !!self && !canPlace(self);
  const myRequest = op.requests.find((r) => r.userId === me)?.partyId ?? null;
  const canAnswer = (party: Party, p: Person) => open && (party.leaderId === me || perms.isOrganiser || overOwnClan(p));

  const sel = selected === null ? undefined : person.get(selected);
  const selParty = sel ? partyOf(sel.userId) : null;

  // A plain render function, not a component: a component defined here would
  // be remounted on every state change, which cancels a drag in progress.
  const card = (p: Person, party: Party | null) => {
    const draggable = canKick(p);
    const c = shown(p);
    const boxes = (p.characters ?? []).filter((x) => x.box).length;
    // The rest of their list: the one they are bringing is on the card already.
    const others = (p.characters ?? []).filter((x) => x.name.toLowerCase() !== c.name.toLowerCase());
    return (
      <li
        key={p.userId}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(p.userId));
          setDragging(p.userId);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
      >
        <button
          type="button"
          aria-pressed={selected === p.userId}
          onClick={() => setSelected(selected === p.userId ? null : p.userId)}
          className={`flex w-full items-center gap-2 rounded-sm border px-2 py-1 text-left transition-colors duration-150 ${
            selected === p.userId ? "border-gold-bright bg-bg-2" : "border-line bg-bg-2/60 hover:border-gold-dim"
          } ${draggable ? "cursor-grab" : "cursor-default"}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${online.has(p.userId) ? "bg-net-party" : "bg-line"}`} role="img" aria-label={online.has(p.userId) ? t("App open") : t("Offline")} />
          <span className={`truncate font-medium ${p.userId === me ? "text-gold-bright" : ""} ${c.status === "out" ? "line-through decoration-danger/70" : ""}`}>
            {c.name}
            {c.usual && <span className="font-normal text-text-muted"> ({c.usual})</span>}
          </span>
          {c.tag && <span className="text-xs text-gold">{c.tag}</span>}
          {c.band && <span className="whitespace-nowrap text-xs text-text-muted tabular-nums">{c.band}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-text-muted">
            {boxes > 0 && <span className="text-text-muted" data-boxes aria-label={`${boxes} ${boxes === 1 ? "box" : "boxes"}`}>+{boxes}</span>}
            {c.status === "coming" && <span className="text-net-party" role="img" aria-label={t("Coming")}>✓</span>}
            {c.status === "out" && <span className="text-danger">{t("Out")}</span>}
            {op.eventLeaderId === p.userId && <span className="text-net-broadcast">{t("♛ Lead")}</span>}
            {op.deputyIds.includes(p.userId) && <span className="text-net-broadcast">{t("Deputy")}</span>}
            {p.clanRole === "leader" && <span className="text-net-clan">{t("⚑ Clan")}</span>}
            {p.clanRole === "officer" && <span className="text-net-clan">{t("Officer")}</span>}
            {party?.leaderId === p.userId && <span className="text-net-command">{t("» PL")}</span>}
            {op.clans.length > 1 && <ClanMark clanId={p.clanId} tag={p.clanTag} size={16} />}
          </span>
        </button>
        {/* The selected player's other characters, from their own standing list. */}
        {selected === p.userId && others.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-3 px-2 pb-1 pt-0.5 text-xs text-text-muted" data-card-characters>
            {t("also")}
            {others.map((x) => <CharacterLine key={x.id} c={x} />)}
          </div>
        )}
      </li>
    );
  };

  const here = set?.operation?.id === op.id;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className="btn btn-quiet text-sm" onClick={onBack}>{t("← Operations")}</button>
        <h1 className="title text-gold-bright">{op.name}</h1>
        {op.eventType && <span className="rounded-sm border border-gold-dim px-1.5 text-xs text-gold" data-event-type>{op.eventType}</span>}
        <span className={`text-xs uppercase tracking-wider ${STATE_CLASS[op.state]}`}>{t(STATE_LABEL[op.state])}</span>
        <span className="text-text-muted">{when(op.startsAt)}</span>
        <span className="flex items-center gap-1.5 text-text-muted">
          {op.clans.map((c) => <ClanCrest key={c.id} clanId={c.id} size={18} />)}
          {op.clans.map((c) => c.name).join(", ")} · {tn(op.people.length, "{n} player", "{n} players")} · {t(`${d(op.people.filter((p) => online.has(p.userId)).length)} online`)}
        </span>
        {open && (
          <span className="text-text-muted" data-answers>
            <span className="text-net-party">{t(`${d(answers.coming)} coming`)}</span> · {t(`${d(answers.out)} can't`)} · {t(`${d(op.people.length - answers.coming - answers.out)} no answer`)}
          </span>
        )}
        {open && op.parties.length > 0 && (
          <span className="text-text-muted" data-parties>
            {tn(op.parties.length, "{n} party", "{n} parties")} · <span className={full === op.parties.length ? "text-net-party" : ""}>{t(`${d(full)} full`)}</span>
          </span>
        )}
        {open && !here && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" className="btn text-sm" onClick={() => select(op.id)}>{t("Join voice")}</button>
            <Help text={t("Connects your voice to this operation's nets now, before it goes live. Use it to form up early; going live pulls everyone in anyway.")} />
          </span>
        )}
        {here && <span className="ml-auto text-xs text-net-party">{t("Your voice is here")}</span>}
      </div>

      {/* Operation controls */}
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 p-3">
        <span>
          <span className="text-text-muted">{t("Event leader")} </span>
          <span className="font-medium">{person.get(op.eventLeaderId)?.name ?? "?"}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-text-muted">{t("Deputies")}</span>
          {op.deputyIds.length === 0 && <span className="text-text-muted">{t("none")}</span>}
          {op.deputyIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-sm border border-line px-2 py-0.5">
              {person.get(id)?.name ?? "?"}
              {canRunOp && open && (
                <button type="button" className="text-text-muted hover:text-danger cursor-pointer" aria-label={t(`Remove deputy ${d(person.get(id)?.name ?? "")}`)} onClick={() => run("op.setDeputy", { userId: id, on: false })}>
                  ×
                </button>
              )}
            </span>
          ))}
        </span>
        {canRunOp && open && (
          <span className="ml-auto flex items-center gap-2">
            <button type="button" className="btn btn-quiet text-sm" aria-pressed={editing} onClick={() => setEditing(!editing)}>{t("Edit")}</button>
            {op.state === "planned" && (
              <ConfirmButton className="btn text-sm" confirm={t("Go live now?")} onConfirm={() => run("op.setState", { state: "live" })}>{t("Start operation")}</ConfirmButton>
            )}
            <ConfirmButton confirm={t("End for everyone?")} onConfirm={() => run("op.setState", { state: "ended" })}>{t("End operation")}</ConfirmButton>
            <Help text={t("Edit: change the name or the start time. An alliance admin can also change the event leader and, before it starts, the clans taking part; an operation created by mistake is deleted from there.\nStart operation moves every player on the roster from their lounge onto their party and nets.\nEnd operation returns everyone to their lounge and locks this roster. It cannot be reopened.\nStart and End ask you to click a second time to confirm.")} />
          </span>
        )}
        {!open && info.user.runsAlliance && (
          <span className="ml-auto flex items-center gap-1">
            <ConfirmButton confirm={t("Delete it for good?")} disabled={act.busy} onConfirm={() => void act.run(() => rpc("op.delete", { opId })).then((ok) => { if (ok) { refreshInfo(); onBack(); } })}>
              {t("Delete operation")}
            </ConfirmButton>
            <Help text={t("Removes this ended operation for good, with its roster and its attendance. The log keeps a line saying it was deleted. Only alliance admins can do this.")} />
          </span>
        )}
      </div>
      {editing && canRunOp && open && (
        <EditOperation
          key={`${op.name}|${op.eventType}|${op.startsAt}|${op.eventLeaderId}|${op.clans.map((c) => c.id).join()}`}
          op={op}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
            refreshInfo();
          }}
          onDeleted={() => {
            refreshInfo();
            onBack();
          }}
        />
      )}
      {op.state === "planned" && (
        <p className="text-xs text-text-muted -mt-2">
          {t("Players stay in their lounge until you start the operation; starting it pulls everyone into their party automatically.")}
        </p>
      )}

      {/* Priority targets: enemies' names given to the operation, a clan, a party or a player. Shown once there are any, and always to whoever may set them. */}
      {targetsData && (targetsData.targets.length > 0 || canTarget) && (
        <div className="panel flex flex-col gap-2 px-3 py-2" data-board-targets>
          <TargetsTitle />
          <TargetsBox opId={opId} data={targetsData} onChanged={reload} />
        </div>
      )}

      {/* Who was in voice, once it has started: for the organisers, and clan leadership about their own */}
      {op.state !== "planned" && (perms.isOrganiser || perms.leadClanIds.length > 0) && <AttendancePanel key={op.state} opId={opId} live={op.state === "live"} />}
      {/* What was written during it, for whoever was on those nets. While it runs, the chat is on the Voice tab. */}
      {op.state === "ended" && <ChatRecord opId={opId} />}
      {/* Its points, posted or (for whoever may post them) as a draft to review */}
      {op.state === "ended" && <OpPoints opId={opId} />}
      {/* What dropped, and who got it: recorded during the operation or after */}
      {op.state !== "planned" && <OpLoot opId={opId} />}

      {/* My own answer, and for the leader of a constant party, the party's */}
      {open && self && (
        <div className="panel flex flex-col gap-2 px-3 py-2" data-signup>
          <div className="flex flex-wrap items-start gap-3">
            <span className="pt-0.5 text-text-muted">{signup.has(me) ? t("Your answer") : t("Are you coming?")}</span>
            <SignupControl key={`${signup.get(me)?.status ?? "none"}`} opId={opId} status={signup.get(me)?.status ?? null} signup={signup.get(me) ?? null} full onDone={reload} />
          </div>
          {(data.myCps ?? []).map((cp) => (
            <div key={cp.id} className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted">
                {tx(`Your party {name}: ${d(cp.answered)} of ${d(cp.members)} have answered`, { name: <span className="text-text">{cp.name}</span> })}
              </span>
              {cp.answered < cp.members && (
                <button type="button" className="btn btn-quiet text-sm" disabled={act.busy} onClick={() => signCp(cp.id)}>{t("Sign up the whole party")}</button>
              )}
              <Help text={t("Marks every member of your constant party as coming, in one go.\nMembers who already answered for themselves keep their own answer, and anyone can still change theirs.\nThe organiser then sees your party as ready to place.")} />
            </div>
          ))}
        </div>
      )}

      {/* Selected player: the keyboard and touch way to do what dragging does */}
      <div className="panel flex min-h-12 flex-wrap items-center gap-3 px-3 py-2" aria-live="polite">
        {!sel ? (
          <span className="text-text-muted">
            {perms.canEditParties
              ? t("Drag a player to a party, or select one to move them.")
              : canAsk
                ? t("Ask to join a party; its leader accepts or declines.")
                : t("Select a player to see their options.")}
            <Help className="ml-1" text={LEGEND + (perms.canEditParties ? "\n" + t("Clan leaders and officers arrange their own clan's parties: one led by another clan is changed by its own leadership, its party leader or the organisers.\nClick a party's name to rename it, and choose its group type under the name. A new party starts empty; the first player placed in it leads it.\nClick a role a party needs to list the unplaced players of that role in Reserve.") : "")} />
          </span>
        ) : (
          <>
            <span>
              <span className="font-medium">{shown(sel).name}</span>
              <span className="text-text-muted">
                {" "}· {selParty ? selParty.name : t("Reserve")}
                {shown(sel).className && ` · ${shown(sel).className}`}
                {shown(sel).band && ` · ${shown(sel).band}`}
                {shown(sel).status === "coming" && ` · ${t("coming")}`}
                {shown(sel).status === "out" && ` · ${t("can't come")}`}
                {shown(sel).note && ` · “${shown(sel).note}”`}
              </span>
            </span>
            {canKick(sel) && (
              <select
                className="field w-auto"
                value=""
                aria-label={t(`Move ${d(sel.name)} to`)}
                onChange={(e) => move(sel.userId, e.target.value === "reserve" ? null : Number(e.target.value))}
              >
                <option value="" disabled>{t("Move to…")}</option>
                {canPlace(sel) &&
                  op.parties.filter((p) => p.id !== selParty?.id && ours(p)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.memberIds.length})</option>
                  ))}
                {selParty && <option value="reserve">{t("Reserve")}</option>}
              </select>
            )}
            {selParty && selParty.leaderId !== sel.userId && canLead(sel, selParty) && (
              <button type="button" className="btn btn-quiet text-sm" onClick={() => run("party.setLeader", { partyId: selParty.id, userId: sel.userId })}>
                {t("Make party leader")}
              </button>
            )}
            {canRunOp && open && sel.userId !== op.eventLeaderId && !op.deputyIds.includes(sel.userId) && (
              <button type="button" className="btn btn-quiet text-sm" onClick={() => run("op.setDeputy", { userId: sel.userId, on: true })}>
                {t("Make deputy")}
              </button>
            )}
            <Help text={t("Move to: places this player in another party, or back in Reserve.\nMake party leader: party leaders are on Command and answer requests to join their party.\nMake deputy: deputies speak on Broadcast and Command and can move anyone.\nYou only see the actions you are allowed to take.")} />
            <button type="button" className="ml-auto text-text-muted hover:text-text cursor-pointer" onClick={() => setSelected(null)}>{t("Clear")}</button>
          </>
        )}
        {act.busy && <span className="text-text-muted">{t("Saving…")}</span>}
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
        {placed && <span className="text-text-muted" role="status">{placed}</span>}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {op.parties.map((party) => (
            <PartyBlock
              key={party.id}
              party={party}
              highlight={over === party.id}
              canEdit={perms.canEditParties}
              canRename={(perms.canEditParties && ours(party)) || (open && party.leaderId === me)}
              kinds={game?.groupTypes ?? []}
              size={PARTY_SIZE}
              state={open && game ? stateOf(party) : null}
              onKind={(kind) => run("party.setKind", { partyId: party.id, kind })}
              onNeed={perms.canEditParties ? setRole : undefined}
              needShown={role}
              onDragOver={allow(party.id)}
              onDragLeave={() => setOver(null)}
              onDrop={drop(party.id)}
              onRename={(name) => run("party.rename", { partyId: party.id, name })}
              onDelete={() => run("party.delete", { partyId: party.id })}
              footer={
                <>
                  {op.requests
                    .filter((r) => r.partyId === party.id)
                    .map((r) => {
                      const p = person.get(r.userId);
                      if (!p) return null;
                      return (
                        <div key={r.userId} className="flex flex-wrap items-center gap-2 rounded-sm border border-dashed border-gold-dim px-2 py-1">
                          <span className="truncate text-text-muted">
                            {tx("{who} asks to join", {
                              who: (
                                <span className="text-text">
                                  <span className="font-medium">{p.name}</span>
                                  {p.classTag && <span className="ml-1 text-xs text-gold">{p.classTag}</span>}
                                </span>
                              ),
                            })}
                          </span>
                          {canAnswer(party, p) ? (
                            <span className="ml-auto flex gap-1">
                              <button type="button" className="btn text-xs px-2 py-0.5" onClick={() => run("party.answerJoin", { partyId: party.id, userId: p.userId, accept: true })}>{t("Accept")}</button>
                              <button type="button" className="btn btn-quiet text-xs px-2 py-0.5" onClick={() => run("party.answerJoin", { partyId: party.id, userId: p.userId, accept: false })}>{t("Decline")}</button>
                            </span>
                          ) : (
                            p.userId === me && (
                              <button type="button" className="ml-auto text-xs text-text-muted hover:text-danger cursor-pointer" onClick={() => run("party.cancelJoin", {})}>{t("Cancel")}</button>
                            )
                          )}
                        </div>
                      );
                    })}
                  {canAsk && !party.memberIds.includes(me) && myRequest !== party.id && (
                    <button type="button" className="btn btn-quiet text-xs self-start px-2 py-0.5" onClick={() => run("party.requestJoin", { partyId: party.id })}>
                      {t("Ask to join")}
                    </button>
                  )}
                </>
              }
            >
              {party.memberIds.map((id) => {
                const p = person.get(id);
                return p ? card(p, party) : null;
              })}
            </PartyBlock>
          ))}
          {perms.canEditParties && open && offered.length > 0 && (
            <div className="flex min-h-24 flex-col gap-2 rounded-sm border border-dashed border-gold-dim p-3">
              <span className="flex items-center gap-1 text-text-muted">
                {t("Constant parties")}
                <Help text={t("Standing groups set up on the Clan screen. Click one to put it on the board as a ready party, with its members in order and its leader in charge.\nA member who is already in another party here stays where they are. Afterwards the party is an ordinary one: change it freely, the constant party itself is not affected.")} />
              </span>
              <div className="flex flex-wrap gap-2">
                {offered.map((cp) => (
                  <button key={cp.id} type="button" className="btn btn-quiet text-sm" disabled={act.busy} onClick={() => addCps(cp.id)}>
                    {cp.name} ({cp.members})
                  </button>
                ))}
              </div>
              {offered.length > 1 && (
                <div>
                  <button type="button" className="btn text-sm" disabled={act.busy} onClick={() => addCps(null)}>{t(`Add all ${d(offered.length)}`)}</button>
                </div>
              )}
            </div>
          )}
          {perms.canEditParties && (
            <button
              type="button"
              onClick={() => run("party.create", { name: "" })}
              className="min-h-24 rounded-sm border border-dashed border-gold-dim text-gold hover:border-gold hover:text-gold-bright cursor-pointer transition-colors duration-150"
            >
              {t("+ New party")}
            </button>
          )}
          {op.parties.length === 0 && !perms.canEditParties && <p className="text-text-muted">{t("No parties have been formed yet.")}</p>}
        </div>

        <div
          onDragOver={allow("reserve")}
          onDragLeave={() => setOver(null)}
          onDrop={drop(null)}
          className={`panel flex w-full flex-col gap-3 p-3 lg:w-72 ${over === "reserve" ? "border-gold-bright" : ""}`}
        >
          <h2 className="title flex items-center gap-1 text-sm text-net-reserve">
            {t("Reserve")}
            <Help text={t("Everyone taking part who is not in a party yet, with those who said they are coming first. They can talk to each other and to the organisers placing them.\nShow: narrow the list to one role, for example to find a healer for a party that lacks one.")} />
            <span className="ml-auto font-sans tabular-nums">{op.reserveIds.length}</span>
          </h2>
          {op.reserveIds.length === 0 ? (
            <p className="text-text-muted">{t("Everyone has a party.")}</p>
          ) : (
            <>
              {game && (
                <label className="flex items-center gap-2 text-text-muted">
                  {t("Show")}
                  <select className="field w-auto py-0.5" value={role} onChange={(e) => setRole(e.target.value)} aria-label={t("Show which role")}>
                    <option value="">{t("Every role")}</option>
                    {game.roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              )}
              {(
                [
                  ["coming", t("Coming"), "text-net-party"],
                  [null, t("No answer yet"), "text-text-muted"],
                  ["out", t("Can't come"), "text-danger"],
                ] as const
              ).map(([status, label, tone]) => {
                const list = op.reserveIds
                  .map((id) => person.get(id))
                  .filter((p): p is Person => !!p && shown(p).status === status && (!role || roleOf(game, shown(p).className) === role));
                if (list.length === 0) return null;
                return (
                  <div key={label} className="flex flex-col gap-1" data-reserve={status ?? "none"}>
                    <h3 className={`flex items-center text-xs uppercase tracking-wider ${tone}`}>
                      {label}
                      <span className="ml-auto font-sans tabular-nums">{list.length}</span>
                    </h3>
                    <ul className={`flex flex-col gap-1 ${status === "out" ? "opacity-60" : ""}`}>{list.map((p) => card(p, null))}</ul>
                  </div>
                );
              })}
              {role && !op.reserveIds.some((id) => { const p = person.get(id); return !!p && roleOf(game, shown(p).className) === role; }) && (
                <p className="text-text-muted">{t(`No unplaced ${d(role.toLowerCase())} here.`)}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PartyBlock({
  party,
  children,
  highlight,
  canEdit,
  canRename,
  kinds,
  size: PARTY_SIZE,
  state,
  onRename,
  onKind,
  onNeed,
  needShown,
  onDelete,
  footer,
  ...dnd
}: {
  party: Party;
  children: React.ReactNode;
  highlight: boolean;
  canEdit: boolean;
  canRename: boolean;
  /** The group types on offer; empty while the lists load or on an older server. */
  kinds: string[];
  /** How many players make this alliance's party full. */
  size: number;
  /** How full the party is and what it lacks; null once the operation has ended. */
  state: { able: number; noClass: number; missing: string[] } | null;
  onRename: (name: string) => void;
  onKind: (kind: string) => void;
  /** Lists the unplaced players of a role in Reserve. Only for those who place players. */
  onNeed?: (role: string) => void;
  /** The role Reserve is narrowed to now. */
  needShown: string;
  onDelete: () => void;
  /** Join requests and the ask-to-join button. */
  footer?: React.ReactNode;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const count = party.memberIds.length;
  return (
    <div {...dnd} data-party={party.id} className={`panel flex flex-col gap-2 p-3 ${highlight ? "border-gold-bright" : ""}`}>
      <div className="flex items-baseline gap-2">
        {editing ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              setEditing(false);
              if (name && name !== party.name) onRename(name);
            }}
          >
            <input name="name" defaultValue={party.name} maxLength={48} autoFocus onBlur={() => setEditing(false)} className="field py-0.5" aria-label={t("Party name")} />
          </form>
        ) : (
          <h2 className="title flex-1 truncate text-sm text-net-party">
            {canRename ? (
              <button type="button" className="title cursor-text hover:text-gold-bright" aria-label={t(`Rename ${d(party.name)}`)} onClick={() => setEditing(true)}>{party.name}</button>
            ) : (
              party.name
            )}
          </h2>
        )}
        {party.cpId !== null && <span className="text-xs uppercase tracking-wider text-gold-dim">{t("Constant")}</span>}
        <span className={`tabular-nums ${count > PARTY_SIZE ? "text-danger" : "text-text-muted"}`}>{count}/{PARTY_SIZE}</span>
      </div>
      {(kinds.length > 0 || party.kind || state) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {canRename && kinds.length > 0 ? (
            <select className="field w-auto py-0 text-xs" value={party.kind ?? ""} onChange={(e) => onKind(e.target.value)} aria-label={t(`Group type of ${d(party.name)}`)}>
              <option value="">{t("Group type")}</option>
              {kinds.map((k) => <option key={k} value={k}>{t(`${d(k)} group`)}</option>)}
            </select>
          ) : (
            party.kind && <span className="text-gold">{t(`${d(party.kind)} group`)}</span>
          )}
          {state && (
            <span className={`ml-auto uppercase tracking-wider ${state.able >= PARTY_SIZE ? "text-net-party" : "text-text-muted"}`} data-ready>
              {state.able >= PARTY_SIZE ? t("Full") : t("Not ready")}
            </span>
          )}
        </div>
      )}
      {state && (state.missing.length > 0 || state.noClass > 0) && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted" data-needs>
          {state.missing.length > 0 && <span>{t("Needs")}</span>}
          {state.missing.map((r) =>
            onNeed ? (
              <button
                key={r}
                type="button"
                aria-pressed={needShown === r}
                title={t(`Show unplaced ${d(r.toLowerCase())}s in Reserve`)}
                onClick={() => onNeed(needShown === r ? "" : r)}
                className={`rounded-sm border px-1.5 cursor-pointer transition-colors duration-150 ${needShown === r ? "border-gold-bright text-gold-bright" : "border-gold-dim text-gold hover:border-gold"}`}
              >
                {r}
              </button>
            ) : (
              <span key={r} className="rounded-sm border border-line px-1.5 text-gold">{r}</span>
            ),
          )}
          {state.noClass > 0 && <span className={state.missing.length > 0 ? "ml-1" : ""}>{t(`${d(state.noClass)} with no class set`)}</span>}
        </div>
      )}
      {count > PARTY_SIZE && <p className="text-xs text-danger">{t(`Over the usual party size of ${d(PARTY_SIZE)}.`)}</p>}
      {count === 0 ? <p className="py-3 text-center text-text-muted">{t("Empty")}</p> : <ul className="flex flex-col gap-1">{children}</ul>}
      {footer}
      {canEdit && (
        <div className="flex justify-end">
          <ConfirmButton className="text-xs text-text-muted hover:text-danger cursor-pointer" confirm={t("Delete party?")} onConfirm={onDelete}>{t("Delete")}</ConfirmButton>
        </div>
      )}
    </div>
  );
}
