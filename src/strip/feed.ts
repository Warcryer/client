// What the main window tells the compact strip, and how. Both windows are the
// same site in the same browser, so a BroadcastChannel reaches from one to the
// other without going through the native side or the server.

import type { ChatView } from "../chat";
import type { NetKind } from "../settings";

export const CHANNEL = "warcryer-strip";
/** Where the strip was last dragged to, kept for next time. Screen position in CSS pixels. */
export const POSITION_KEY = "strip.pos";

export type StripSpeaker = { name: string; crest: string | null; tag: string | null };
export type StripLine = { net: NetKind; label: string; /** What the strip calls this net, in the alliance's words. */ short: string; you: boolean; lowered: boolean; speakers: StripSpeaker[] };
export type StripState = {
  /** Lounge name or operation name; null when not in voice at all. */
  where: string | null;
  /** Nets with someone speaking right now, highest priority first. */
  lines: StripLine[];
  muted: boolean;
  /** The headset is off: the player hears no one. */
  deafened?: boolean;
  /** Broadcast is locked open for a briefing. */
  locked: boolean;
  /** The operation's text chat, for the chat window the strip opens into. */
  chat?: ChatView;
  /** The language the app is shown in: the strip is a window of its own and follows the main one. */
  lang?: string;
};

export type ToStrip = { type: "state"; state: StripState };
export type FromStrip =
  | { type: "hello" }
  | { type: "close" }
  // What the player did in the chat window; the main window has the connection.
  | { type: "chat-say"; room: string; text: string }
  | { type: "chat-watch"; room: string | null }
  | { type: "chat-remove"; id: number }
  | { type: "chat-mute"; userId: number; on: boolean }
  | { type: "chat-order"; text: string }
  | { type: "chat-call"; slot: number }
  | { type: "ready-check"; start: boolean }
  | { type: "ready-answer"; ready: boolean }
  // The mic and headset buttons; the main window has the voice.
  | { type: "mic-toggle" }
  | { type: "headset-toggle" };
