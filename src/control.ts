// The control channel: one WebSocket to the backend that tells this client
// which rooms it belongs in. The client never decides that for itself.

import type { NetKind } from "./settings";

export type NetGrant = { net: NetKind; label: string; room: string; speak: boolean; token: string; /** Broadcast only: this player (the event leader) may lock it open for a briefing. */ lock?: boolean; /** May write in this net's chat. Absent on a server older than the chat. */ write?: boolean };
export type OpInfo = { id: number; name: string; state: "planned" | "live" | "ended" };
/** A group between operations (decision 64), as the control service sends it to everyone in the alliance. */
export type GroupInfo = {
  id: number;
  label: string;
  name: string;
  starterId: number | null;
  members: { userId: number; name: string; classTag: string | null; clanId: number | null; clanTag: string | null; mayRemove?: boolean }[];
};

export type NetSet = {
  /** The alliance's quick calls by slot, "" for one not in use. Absent on a server before 0.24. */
  calls?: string[];
  url: string;
  operation: OpInfo | null;
  operations: OpInfo[];
  /** True when these are lounge rooms, not an operation's nets. */
  lounge: boolean;
  nets: NetGrant[];
  notice?: { kind: "moved" | "leader"; party: string | null };
  /** Parties whose leader has dropped out, where this player is asked to pick a new one. */
  leaderLost?: LeaderLost[];
  /** The operation's text chat, as it stands for this player; null in a lounge, absent on an older server. */
  chat?: ChatInfo | null;
};
/**
 * `moderates`: may remove others' lines and switch writers off (then `mutedIds` lists who is). `muted`: this
 * player's own writing is switched off. `organises`: runs the operation, so may pin the order and, if the
 * alliance allows it (`readyCheck`), ask whether everyone is ready. `order` and `ready` are how things stand
 * as the net set is sent; changes after that come as events. The last four are absent on a server before 0.23.
 */
export type ChatInfo = { moderates: boolean; muted: boolean; mutedIds?: number[]; organises?: boolean; readyCheck?: boolean; order?: ChatOrder | null; ready?: ReadyAsk | null };
/** The order pinned on the operation. */
export type ChatOrder = { text: string; by: string; at: string };
/** A ready check this player is asked to answer. `endsAt` is the server's clock, in milliseconds. */
export type ReadyAsk = { id: number; by: string; endsAt: number };
/** Where a ready check stands. Names only reach those who run the operation. */
export type ReadyState = { id: number; ready: number; notReady: number; waiting: number; names?: { notReady: string[]; waiting: string[] }; endsAt?: number };
/** One line of an operation's chat. `room` is its net's room. */
export type ChatLine = { id: number; room: string; userId: number; name: string; tag: string | null; text: string; at: string; /** Sent as a quick call. */ quick?: true };
/** What the server says about the chat. `n` is the number this app gave a line it sent. */
export type ChatEvent =
  | { type: "chat"; line: ChatLine; n?: number }
  | { type: "chat.history"; room: string; lines: ChatLine[] }
  | { type: "chat.removed"; room: string; id: number }
  | { type: "chat.refused"; n: number | null; why: string }
  | { type: "order"; order: ChatOrder | null }
  | { type: "ready"; check: ReadyAsk }
  | ({ type: "ready.state" } & ReadyState)
  | ({ type: "ready.done" } & ReadyState);
export type LeaderLost = { partyId: number; party: string; leader: string; members: { id: number; name: string; here: boolean }[] };
export type Me = { id: number; name: string; classTag: string | null; nameSet: boolean; isAdmin: boolean };
export type ControlState = "connecting" | "online" | "offline";
/** Why the server ended the session for good. */
export type Ended = "replaced" | "signed_out";

/**
 * Why a control connection ended, as the app saw it. Sent to the server once the next connection is up,
 * where it is written to the service's log: a dropped connection looks the same from the server whatever
 * caused it, and only the app can say whether it was closed cleanly, had gone silent, or ended as the
 * network changed under it. It carries nothing about the player or what they were doing.
 */
type HowEnded = {
  /** The host the connection went to: the voice host (direct) or the site's own (behind the CDN). */
  via: string;
  /** The WebSocket close code (1006: cut off without a goodbye), or "silent" when the app itself gave the connection up. */
  code: number | "silent";
  clean: boolean;
  reason: string;
  /** How long the connection had been open, and how long since the server was last heard on it. */
  openMs: number;
  silentMs: number;
  /** What the browser part of the app believed about the network at that moment. */
  online: boolean;
  hidden: boolean;
  /** How long before the end the system last reported a change of network, if it did while the connection was open. */
  netChangeMsAgo: number | null;
  /** How long the system has said "offline" at any point while the connection was open. */
  wentOffline: boolean;
};

/**
 * How often the app asks the server for a sign of life. Often enough that a
 * connection a home router has forgotten is found out within seconds (the
 * next thing sent on it is refused), and that it never looks idle to one.
 */
const PING_MS = 10_000;
/** How long the server may say nothing, with a ping asked every PING_MS, before the connection counts as dead. */
const SILENCE_MS = 25_000;

export class ControlClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private stopped = false;
  /** When the server was last heard from on the current connection. */
  private heardAt = 0;
  private openedAt = 0;
  /** What the system said about the network while the current connection was open. */
  private netChangedAt = 0;
  private wentOffline = false;
  /** How the previous connection ended; told to the server on the next hello. */
  private last: HowEnded | null = null;
  private voiceReports: { net: string; said: string[]; online: boolean; hidden: boolean; netChangeMsAgo: number | null; at: number }[] = [];
  private voiceTimer: number | undefined;
  private watching = false;

  onState: (s: ControlState) => void = () => {};
  onHello: (me: Me) => void = () => {};
  onNetSet: (set: NetSet) => void = () => {};
  onEnded: (why: Ended) => void = () => {};
  /** Something in the roster changed; any open roster screen should reload. */
  /** The roster changed. `operationId` is set when the change is inside one operation, null when it may be wider (clans, crests, lounges). */
  onChanged: (operationId: number | null) => void = () => {};
  /** The alliance's groups as they are now (decision 64), sent whenever they change. */
  onGroups: (groups: GroupInfo[]) => void = () => {};
  /** Something about the operation's text chat. */
  onChat: (e: ChatEvent) => void = () => {};
  private chatN = 0;

  /** Writes a line on a net. Answers with the number given to it; a refusal names that number. */
  say(room: string, text: string): number {
    const n = ++this.chatN;
    this.send({ type: "chat", room, text, n });
    return n;
  }
  /** Asks for the last lines of a net: on arriving on it, and after being away. */
  askHistory(room: string) {
    this.send({ type: "chat.history", room });
  }
  removeLine(id: number) {
    this.send({ type: "chat.remove", id });
  }
  /** Switches a player's writing off, or on again, for the operation. For those who keep order in it. */
  muteWriter(userId: number, on: boolean) {
    this.send({ type: "chat.mute", userId, on });
  }
  /** Sends one of the alliance's quick calls, by its slot (1 to 8), into the player's party. */
  call(slot: number) {
    this.send({ type: "chat.call", slot });
  }
  /** Pins an order for the whole operation; empty text clears it. For those who run it. */
  setOrder(text: string) {
    this.send({ type: "order.set", text });
  }
  /** Asks everyone on the operation whether they are ready, or ends the asking early. For those who run it. */
  readyCheck(start: boolean) {
    this.send({ type: start ? "ready.start" : "ready.stop" });
  }
  answerReady(id: number, ready: boolean) {
    this.send({ type: "ready.answer", id, ready });
  }

  /** Which of the ways in is being used, and how many attempts on it in a row have ended before the server said hello. */
  private way = 0;
  private misses = 0;

  /**
   * `urls`: the ways in to the control service, the preferred one first. `token` is the desktop session
   * token; the browser passes null and is recognised by its cookie.
   */
  constructor(private urls: string[], private token: string | null) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** Whether this player's headset is off, as last told; told again on every new connection. */
  private headsetOff = false;

  /** Tells the server the headset went off or on, so the others in the player's rooms see it (decision 59). */
  setHeadset(off: boolean) {
    if (off === this.headsetOff) return;
    this.headsetOff = off;
    this.send({ type: "headset", off });
  }

  /** Choose where to be: an operation, the lounge, or "auto" to let the server decide. */
  select(target: number | "lounge" | "auto") {
    this.send({ type: "select", operationId: typeof target === "number" ? target : null, lounge: target === "lounge" });
  }

  /**
   * Tells the server why a voice room's signalling dropped, for the service's log. Not at once: when
   * voice drops, this connection has usually died with it and does not know yet, and a report sent
   * into it would be lost. It goes with the next connection, or after a wait if this one was fine.
   */
  reportVoice(what: { net: string; said: string[] }) {
    this.voiceReports.push({ net: what.net, said: what.said.slice(0, 8), online: navigator.onLine, hidden: document.visibilityState === "hidden", netChangeMsAgo: this.netChangedAt ? Date.now() - this.netChangedAt : null, at: Date.now() });
    if (this.voiceReports.length > 6) this.voiceReports.shift();
    window.clearTimeout(this.voiceTimer);
    this.voiceTimer = window.setTimeout(() => this.flushVoice(), 45_000);
  }

  private flushVoice() {
    window.clearTimeout(this.voiceTimer);
    if (this.ws?.readyState !== WebSocket.OPEN) return; // kept for the next connection
    for (const r of this.voiceReports.splice(0)) {
      const { at, ...rest } = r;
      this.send({ type: "diag", voice: { ...rest, agoMs: Date.now() - at } });
    }
  }

  /** Ask for fresh tokens, after a room could not reconnect with the ones we hold. */
  refresh() {
    this.send({ type: "refresh" });
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Notes how the connection that has just ended did so. */
  private note(code: number | "silent", clean: boolean, reason: string, via: string) {
    const now = Date.now();
    this.last = {
      via,
      code,
      clean,
      reason: reason.slice(0, 60),
      openMs: this.openedAt ? now - this.openedAt : 0,
      silentMs: this.heardAt ? now - this.heardAt : 0,
      online: navigator.onLine,
      hidden: document.visibilityState === "hidden",
      netChangeMsAgo: this.netChangedAt >= this.openedAt && this.netChangedAt > 0 ? now - this.netChangedAt : null,
      wentOffline: this.wentOffline,
    };
  }

  /** Listens, once, to what the system says about the network. */
  private watchNetwork() {
    if (this.watching) return;
    this.watching = true;
    const changed = () => (this.netChangedAt = Date.now());
    window.addEventListener("offline", () => {
      this.wentOffline = true;
      changed();
    });
    window.addEventListener("online", changed);
    (navigator as Navigator & { connection?: EventTarget }).connection?.addEventListener("change", changed);
  }

  private open() {
    this.onState("connecting");
    this.watchNetwork();
    const url = this.urls[this.way];
    const via = new URL(url).hostname;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.openedAt = 0;
    ws.onopen = () => {
      if (this.token) ws.send(JSON.stringify({ type: "auth", token: this.token }));
    };
    ws.onmessage = (e) => {
      this.heardAt = Date.now();
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === "hello") {
        this.retry = 0;
        this.misses = 0;
        this.openedAt = Date.now();
        this.wentOffline = false;
        if (this.last) {
          ws.send(JSON.stringify({ type: "diag", last: this.last }));
          this.last = null;
          // Voice dropped with it, most likely: its reports go now, over the connection that works.
          this.flushVoice();
        }
        // A new connection starts with the headset on, as far as the server knows.
        if (this.headsetOff) ws.send(JSON.stringify({ type: "headset", off: true }));
        this.onState("online");
        this.onHello(msg.user as Me);
      } else if (msg.type === "netset") {
        this.onNetSet(msg as unknown as NetSet);
      } else if (typeof msg.type === "string" && /^(chat|order|ready)(\.|$)/.test(msg.type)) {
        this.onChat(msg as unknown as ChatEvent);
      } else if (msg.type === "groups" && Array.isArray(msg.groups)) {
        this.onGroups(msg.groups as GroupInfo[]);
      } else if (msg.type === "changed") {
        this.onChanged(typeof msg.operationId === "number" ? msg.operationId : null);
      } else if (msg.type === "replaced" || msg.type === "signed_out") {
        this.stopped = true;
        this.onEnded(msg.type);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      window.clearInterval(this.pingTimer);
      if (this.stopped) return;
      // Only a connection that had come up is worth reporting on; a failed attempt to connect says nothing new.
      if (this.openedAt) {
        this.note(e.code, e.wasClean, e.reason, via);
        // After a connection that worked, the preferred way in is tried first again.
        this.way = 0;
        this.misses = 0;
      } else if (++this.misses >= 2 && this.urls.length > 1) {
        // Twice in a row this way in did not get as far as hello: try the other.
        this.way = (this.way + 1) % this.urls.length;
        this.misses = 0;
        this.retry = 0;
      }
      // The browser fallback has no token to be refused with a message, so a
      // refusal shows up as the close code.
      if (e.code === 4003) {
        this.stopped = true;
        return this.onEnded("signed_out");
      }
      if (e.code === 4001) {
        this.stopped = true;
        return this.onEnded("replaced");
      }
      // A dropped connection is retried quietly. Voice keeps running meanwhile.
      this.onState("offline");
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => {};
    // Every ping is answered. A connection that has gone quiet for longer than two of them is dead,
    // whatever the network in between still pretends: give it up and connect again, rather than sit
    // "online" while hearing nothing of roster changes. (The interval may run late while the window is
    // hidden; it is the silence that is measured, not the number of pings.)
    this.heardAt = Date.now();
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (this.ws === ws && ws.readyState === WebSocket.OPEN && Date.now() - this.heardAt > SILENCE_MS) {
        // Not waited for: closing a dead connection politely can itself take a minute. It is dropped
        // and a new one opened at once; the server ends the old one when the new one signs in.
        this.note("silent", false, "", via);
        this.way = 0;
        this.misses = 0;
        ws.onclose = null;
        ws.onmessage = null;
        try {
          ws.close();
        } catch {
          /* already gone */
        }
        window.clearInterval(this.pingTimer);
        this.onState("offline");
        return this.open();
      }
      this.send({ type: "ping" });
    }, PING_MS);
  }
}
