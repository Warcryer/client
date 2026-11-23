// The operation's text chat, as this app holds it: the channels (one per net
// the player is on), their lines, and what has not been read yet. The lines
// come over the control connection and are kept only in memory; the server
// has the record.
//
// One store for the whole app. The main window shows it in the Voice tab, and
// passes it on to the chat window (the strip), which has no connection of its
// own.

import { d, t } from "./words";
import type { ChatEvent, ChatOrder, ChatTarget, ControlClient, NetSet, ReadyAsk, ReadyState } from "./control";
import type { NetKind } from "./settings";

export type ChatChannel = { room: string; net: NetKind; label: string; /** As NetGrant's: the name's sentence, for said(). */ say?: string; write: boolean };
/** `userId` null: a note from the app itself (you were moved here; a line was not sent), not something anyone wrote. */
export type ChatLineView = { id: number; userId: number | null; name: string; tag: string | null; text: string; at: string; /** Sent as a quick call. */ quick?: true; /** The line in the player's language, when it was translated for them. */ tr?: string };
export type ChatView = {
  /** The operation the chat belongs to; null when not in one. */
  operation: { id: number; name: string } | null;
  /** Between operations: the channels are the player's lounges and group (decision 64). */
  between: boolean;
  /** Between operations: rooms where this player may remove others' lines. */
  modRooms: string[];
  channels: ChatChannel[];
  lines: Record<string, ChatLineView[]>;
  unread: Record<string, boolean>;
  moderates: boolean;
  /** This player's own writing is switched off for the operation. */
  muted: boolean;
  mutedIds: number[];
  /** The player's own number, to tell their lines from others'. */
  me: number | null;
  /** Runs the operation: may pin the order and ask whether everyone is ready. */
  organises: boolean;
  /** The alliance lets its organisers ask for a ready check. */
  readyCheck: boolean;
  /** The order pinned on the operation, if there is one. */
  order: ChatOrder | null;
  /** The priority targets that apply to this player, nearest first (their own, their party's, their clan's, everyone's). */
  targets: ChatTarget[];
  /** A ready check this player has been asked and has not answered. `endsAt` is on this computer's clock. */
  ready: ReadyAsk | null;
  /** How the ready check stands or ended, for a little while after it ends. Names only for those who run the operation. */
  tally: (ReadyState & { done: boolean }) | null;
  /** The alliance's quick calls by slot, "" for one not in use. Known outside operations too, for binding keys. */
  calls: string[];
  /** The quick call that has just come in, for a few seconds: the strip shows it without the chat open. */
  called: { id: number; name: string; text: string; own: boolean } | null;
};

const EMPTY: ChatView = { operation: null, between: false, modRooms: [], channels: [], lines: {}, unread: {}, moderates: false, muted: false, mutedIds: [], me: null, organises: false, readyCheck: false, order: null, targets: [], ready: null, tally: null, calls: [], called: null };
/** Tabs in the order a player reaches for them: their own party first, the orders last and always in sight. */
const ORDER: NetKind[] = ["party", "reserve", "clan", "command", "broadcast", "group", "lounge"];
const KEEP = 300;

let view: ChatView = EMPTY;
let control: ControlClient | null = null;
/** The channel being looked at, in whichever window: its new lines are read at once. */
let watching: string | null = null;
/** Lines sent and not yet answered: the number the control client gave each, and where it was meant for. */
const pending = new Map<number, string>();
let noteId = -1;
/** Clears the result of a ready check a while after it ended. */
let tallyTimer: ReturnType<typeof setTimeout> | undefined;
/** The server's clock may not be this computer's: a check's end is kept as "half a minute from when we heard". */
const READY_MS = 30_000;
const TALLY_STAYS_MS = 20_000;
/** How long a quick call that has just come in stays on the strip. */
const CALLED_STAYS_MS = 6_000;
let calledTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const set = (next: ChatView) => {
  view = next;
  listeners.forEach((l) => l());
};
const note = (text: string): ChatLineView => ({ id: noteId--, userId: null, name: "", tag: null, text, at: new Date().toISOString() });
const add = (room: string, line: ChatLineView, unread: boolean) => {
  if (!view.channels.some((c) => c.room === room)) return;
  const had = view.lines[room] ?? [];
  if (line.id > 0 && had.some((l) => l.id === line.id)) return;
  set({ ...view, lines: { ...view.lines, [room]: [...had, line].slice(-KEEP) }, unread: unread && room !== watching ? { ...view.unread, [room]: true } : view.unread });
};

/** What makes a list of targets a different list: its names and notes, in order. */
export const targetsKey = (targets: ChatTarget[]): string => targets.map((x) => `${x.name}\n${x.note ?? ""}`).join("\n\n");
/**
 * The player's targets changed while they were on the operation: a sound, and a note where their party
 * talks, so that it is noticed in a fight. (The names stand at the top of the chat either way.)
 */
function targetsChanged(targets: ChatTarget[]) {
  const find = (net: NetKind) => view.channels.find((c) => c.net === net)?.room;
  const where = find("party") ?? find("reserve") ?? find("broadcast") ?? view.channels[0]?.room;
  if (where) add(where, note(targets.length ? t(`Your targets now: ${d(targets.map((x) => x.name).join(", "))}`) : t("You have no targets now.")), false);
  chat.onCue("order");
}

function onEvent(e: ChatEvent) {
  if (e.type === "chat") {
    if (e.n !== undefined) pending.delete(e.n);
    add(e.line.room, e.line, e.line.userId !== view.me);
    if (e.line.quick && view.channels.some((c) => c.room === e.line.room)) {
      clearTimeout(calledTimer);
      set({ ...view, called: { id: e.line.id, name: e.line.name, text: e.line.text, own: e.line.userId === view.me } });
      calledTimer = setTimeout(() => set({ ...view, called: null }), CALLED_STAYS_MS);
      chat.onCue("call");
    }
  } else if (e.type === "chat.history") {
    if (!view.channels.some((c) => c.room === e.room)) return;
    // What the server has, in its order; the app's own notes stay where they were said, after it.
    const notes = (view.lines[e.room] ?? []).filter((l) => l.userId === null);
    const known = new Set(e.lines.map((l) => l.id));
    const later = (view.lines[e.room] ?? []).filter((l) => l.userId !== null && !known.has(l.id) && l.id > (e.lines.at(-1)?.id ?? 0));
    set({ ...view, lines: { ...view.lines, [e.room]: [...e.lines, ...later, ...notes].slice(-KEEP) } });
  } else if (e.type === "chat.translated") {
    // The line is on screen already, as written; this is the same line in the player's language.
    const had = view.lines[e.room];
    if (had?.some((l) => l.id === e.id)) set({ ...view, lines: { ...view.lines, [e.room]: had.map((l) => (l.id === e.id ? { ...l, tr: e.text } : l)) } });
  } else if (e.type === "chat.removed") {
    const had = view.lines[e.room];
    if (had?.some((l) => l.id === e.id)) set({ ...view, lines: { ...view.lines, [e.room]: had.filter((l) => l.id !== e.id) } });
  } else if (e.type === "chat.refused") {
    const room = e.n === null ? undefined : pending.get(e.n);
    if (e.n !== null) pending.delete(e.n);
    // A refusal that names no line is about an order or a ready check: say it where the organiser is looking.
    const where = room ?? view.channels.find((c) => c.net === "broadcast")?.room;
    if (where) add(where, note(room ? t(`Not sent. ${d(e.why)}`) : e.why), false);
  } else if (e.type === "order") {
    if (!view.operation) return;
    const fresh = e.order !== null && e.order.at !== view.order?.at;
    set({ ...view, order: e.order });
    if (fresh) chat.onCue("order");
  } else if (e.type === "targets") {
    if (!view.operation || !Array.isArray(e.targets)) return;
    const fresh = targetsKey(e.targets) !== targetsKey(view.targets);
    set({ ...view, targets: e.targets });
    if (fresh) targetsChanged(e.targets);
  } else if (e.type === "ready") {
    if (!view.operation) return;
    set({ ...view, ready: { ...e.check, endsAt: Date.now() + READY_MS } });
    chat.onCue("ready");
  } else if (e.type === "ready.state" || e.type === "ready.done") {
    if (!view.operation) return;
    const done = e.type === "ready.done";
    clearTimeout(tallyTimer);
    const { type: _type, ...state } = e;
    set({ ...view, ready: done && view.ready?.id === e.id ? null : view.ready, tally: { ...state, ...(done ? {} : { endsAt: Date.now() + READY_MS }), done } });
    if (done) tallyTimer = setTimeout(() => view.tally?.done && set({ ...view, tally: null }), TALLY_STAYS_MS);
  }
}

export const chat = {
  /** A sound for a new order, a ready check or a quick call; the app sets it (the sounds live with the voice engine). */
  onCue: (_kind: "order" | "ready" | "call") => {},
  view: () => view,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** The control connection the lines travel over; null when there is none. */
  attach(c: ControlClient | null) {
    control = c;
    if (c) c.onChat = onEvent;
    else {
      pending.clear();
      set(EMPTY);
    }
  },
  /** A net set arrived: the channels are the operation's nets in it. `me` is the player's own number. */
  onNetSet(next: NetSet, me: number | null) {
    const op = next.operation && !next.lounge ? { id: next.operation.id, name: next.operation.name } : null;
    // Between operations the lounges and the group have channels too (decision 64): the group first, then the
    // clan's lounge, then the alliance's.
    const between = !op && next.lounge === true;
    const channels: ChatChannel[] = op || between
      ? next.nets
          .filter((n) => (op ? n.room.startsWith("op-") : n.net === "lounge" || n.net === "group"))
          .map((n) => ({ room: n.room, net: n.net, label: n.label, say: n.say, write: n.write === true }))
          .sort((a, b) => ORDER.indexOf(a.net) - ORDER.indexOf(b.net) || (a.room.startsWith("lounge-alliance") ? 1 : 0) - (b.room.startsWith("lounge-alliance") ? 1 : 0))
      : [];
    const sameOp = (op !== null && view.operation?.id === op.id) || (between && view.between);
    const had = new Set(sameOp ? view.channels.map((c) => c.room) : []);
    const lines: Record<string, ChatLineView[]> = {};
    const unread: Record<string, boolean> = {};
    for (const c of channels) {
      // A net the player was already on keeps its lines. One they have just come onto starts empty and asks for
      // what was said; one they have left is dropped, lines and all.
      lines[c.room] = had.has(c.room) ? (view.lines[c.room] ?? []) : [];
      unread[c.room] = had.has(c.room) ? (view.unread[c.room] ?? false) : false;
      if (!had.has(c.room)) {
        control?.askHistory(c.room);
        if (sameOp && (c.net === "party" || c.net === "reserve") && next.notice?.kind === "moved") lines[c.room] = [note(t("You were moved here."))];
      }
    }
    if (watching && !channels.some((c) => c.room === watching)) watching = null;
    // As the net set says, when it says: an older server says nothing of targets.
    const targets = !op ? [] : next.chat && Array.isArray(next.chat.targets) ? next.chat.targets : sameOp ? view.targets : [];
    // Moved to a party with other names: said like any other change. Arriving on the operation says nothing; the names are there to read.
    const retargeted = op !== null && sameOp && targetsKey(targets) !== targetsKey(view.targets);
    set({
      operation: op,
      between,
      modRooms: between ? (next.chat?.modRooms ?? []) : [],
      channels,
      lines,
      unread,
      moderates: next.chat?.moderates === true,
      muted: next.chat?.muted === true,
      mutedIds: next.chat?.mutedIds ?? [],
      me,
      organises: next.chat?.organises === true,
      readyCheck: next.chat?.readyCheck === true,
      // As the net set says, when it says: an older server says nothing, and what the app knows stays.
      order: !op ? null : next.chat && "order" in next.chat ? (next.chat.order ?? null) : sameOp ? view.order : null,
      targets,
      ready: !op ? null : next.chat?.ready ? { ...next.chat.ready, endsAt: view.ready?.id === next.chat.ready.id ? view.ready.endsAt : Date.now() + READY_MS } : sameOp ? view.ready : null,
      tally: sameOp ? view.tally : null,
      calls: next.calls ?? [],
      called: sameOp ? view.called : null,
    });
    if (retargeted) targetsChanged(targets);
  },
  /** The connection is back after a gap: ask again for what was said meanwhile. */
  resync() {
    for (const c of view.channels) control?.askHistory(c.room);
  },
  say(room: string, text: string) {
    const said = text.trim();
    if (!said || !control) return;
    pending.set(control.say(room, said), room);
  },
  /** A window is showing this channel now (null: none is). Its lines count as read. */
  watch(room: string | null) {
    watching = room;
    if (room && view.unread[room]) set({ ...view, unread: { ...view.unread, [room]: false } });
  },
  remove: (id: number) => control?.removeLine(id),
  mute: (userId: number, on: boolean) => control?.muteWriter(userId, on),
  /** Sends the quick call in that slot (1 to 8) into the player's party. Outside an operation, or for a slot not in use, nothing. */
  call(slot: number) {
    if ((view.operation || view.between) && view.calls[slot - 1]) control?.call(slot);
  },
  /** Pins an order for the whole operation; empty clears it. */
  order: (text: string) => control?.setOrder(text),
  /** Starts a ready check, or ends the one running. */
  readyCheck: (start: boolean) => control?.readyCheck(start),
  /** Answers the ready check on screen. */
  answer(ready: boolean) {
    if (!view.ready) return;
    control?.answerReady(view.ready.id, ready);
    set({ ...view, ready: null });
  },
};
