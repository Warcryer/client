import type { Words } from "./reword";
// Calls to the backend's app API. The desktop app proves who it is with its
// session token; the browser version, served from the site, with the site's cookie.

import { getToken } from "./auth";
import { SERVER } from "./config";

const API: string = import.meta.env.VITE_API_URL ?? SERVER;

/** A refusal from the server, with a message meant for the player. */
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: token ? "omit" : "same-origin",
      body: JSON.stringify({ method, params }),
    });
  } catch {
    throw new ApiError("The server could not be reached.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `The server said ${res.status}.`, res.status);
  return body.result as T;
}

/** Address of a clan's crest image. The version makes it safe to cache for good. */
export const crestUrl = (clanId: number, version: number) => `${API}/api/clan-crest/${clanId}?v=${version}`;

// ---- Shapes returned by the API (mirrors of the backend's types) ----

export type ClanRole = "leader" | "officer" | "member";
export type Membership = { clanId: number; name: string; tag: string; role: ClanRole; status: "pending" | "active" | "removed" };
/** The alliance a player is in, with their role in it. */
export type AllianceInfo = { id: number; name: string; role: "owner" | "admin" | null };
export type Info = {
  /** The player's alliance; null when in none. Missing on a server older than 0.18, where there is only one. */
  alliance?: AllianceInfo | null;
  user: {
    id: number;
    name: string;
    nameSet: boolean;
    classTag: string | null;
    /** Class and level band chosen from the alliance's lists; null until chosen. */
    className: string | null;
    levelBand: string | null;
    /** Runs the service itself. Inside an alliance it counts only in the one they are a member of. */
    isAdmin: boolean;
    isAllianceAdmin: boolean;
    /** Owner or admin of the alliance they are in: may manage its clans, operations and bans. */
    runsAlliance: boolean;
  };
  membership: Membership | null;
  /** Join requests waiting on this player as a clan leader or officer. */
  pendingApprovals: number;
  /** Players asking to join a party this player leads. */
  joinRequests: JoinRequest[];
  /** Operations waiting for this player's "coming" or "cannot come". Absent on servers older than the sign-up feature. */
  openSignups?: { opId: number; name: string; startsAt: string | null; state: OpState }[];
};
/** The alliance's own classes, roles and level bands, served by the server. */
export type GameClass = { name: string; tag: string; role: string | null };
/**
 * The alliance's own game setup, as its admins have it. `groupTypes` and `partyNeeds` are missing on a
 * server older than 0.11; `partySize`, `levelLabel`, `eventTypes` and `nameRule` on one older than 0.17.
 */
export type GameOptions = {
  roles: string[];
  classes: GameClass[];
  levelBands: string[];
  groupTypes?: string[];
  partyNeeds?: string[];
  /** How many players make a full party. */
  partySize?: number;
  /** What the bands measure: "Level", "Gear score". */
  levelLabel?: string;
  /** The alliance's own kinds of event. */
  eventTypes?: string[];
  /** Which characters an in-game name may have, in words. */
  nameRule?: string;
  /** What this alliance calls an alliance, a clan, a party, a constant party and an operation. */
  words?: Words;
};
/** The whole setup, for the editor on the Alliance screen. */
export type GameProfile = { words: Words; preset: string; classes: GameClass[]; roles: string[]; partySize: number; partyNeeds: string[]; groupTypes: string[]; levelLabel: string; levelBands: string[]; eventTypes: string[]; nameRule: string };
export type GameProfileEdit = { profile: GameProfile; presets: { id: string; label: string; profile: GameProfile }[]; nameRules: { id: string; label: string }[] };
/** Where an alliance stands against its plan: approved members against the limit, and whether its operations are paused. */
export type PlanState = { plan: string; label: string; members: number; cap: number; clans: number; clansCap: number | null; suspended: boolean; over: boolean };
export type JoinRequest = { opId: number; opName: string; partyId: number; partyName: string; userId: number; name: string; classTag: string | null };
/** `crest` is 0 when the clan has none. */
export type ClanSummary = { id: number; name: string; tag: string; crest: number; leaderName: string | null; members: number };
/** `discordName`: only on a player waiting to be let in, and only for those who may approve them. */
export type ClanMember = { userId: number; name: string; classTag: string | null; role: ClanRole; status: "pending" | "active"; discordName?: string | null; /** Their other characters, if they have listed any. */ characters?: Character[] };
/** One of a player's other characters, beside the one on their profile. `box`: played at the same time as the main. */
export type Character = { id: number; name: string; className: string | null; classTag: string | null; levelBand: string | null; box: boolean };
/** `discord`: whether the clan's Discord announcements are set up. Only sent to the clan's leader and alliance admins. */
export type ClanView = { clan: { id: number; name: string; tag: string }; myRole: ClanRole | null; members: ClanMember[]; onlineIds: number[]; discord?: boolean; /** The role the clan's announcements ping, if one is chosen. */ discordRole?: string | null };

export type OpState = "planned" | "live" | "ended";
export type OpSummary = {
  id: number;
  name: string;
  /** The alliance's own kind of event, if the operation has one. */
  eventType?: string | null;
  startsAt: string | null;
  state: OpState;
  leaderName: string;
  /** My own answer; null when I have not answered. */
  mySignup?: "coming" | "out" | null;
  /** I am on this operation's roster, so I can answer. */
  canSignUp?: boolean;
  coming?: number;
};
export type Person = {
  userId: number;
  name: string;
  classTag: string | null;
  className?: string | null;
  levelBand?: string | null;
  clanId: number | null;
  clanTag: string | null;
  clanRole: ClanRole | null;
  /** Their other characters, if they have listed any. */
  characters?: Character[];
};
/** A player's answer to "are you coming?". The character fields are set only when they bring a character other than their profile's. */
export type Signup = {
  userId: number;
  status: "coming" | "out";
  charName: string | null;
  className: string | null;
  classTag: string | null;
  levelBand: string | null;
  note: string | null;
  /** The leader of their constant party answered for them. */
  byLeader: boolean;
};
export type Party = { id: number; name: string; /** "Mage", "Fill", ...: what kind of group it is, if said. */ kind?: string | null; leaderId: number | null; memberIds: number[]; leaderLost: boolean; /** The constant party it was made from. */ cpId: number | null };
/** One line of the audit log. `actor` is null for something the server did by itself. */
export type AuditEntry = { id: number; at: string; actor: string | null; text: string; operation: string | null };
/** An open invite link of a clan, as its leadership sees it. */
export type Invite = { code: string; link: string; createdBy: string; expiresAt: string; maxUses: number; uses: number; autoApprove: boolean };
/** A constant party: a standing group in a clan, dropped onto a board as a ready party. */
export type Cp = { id: number; clanId: number; name: string; leaderId: number | null; members: { userId: number; name: string; classTag: string | null }[] };
export type CpList = { cps: Cp[]; canCreate: boolean };
/** A constant party the viewer may add to a board. */
export type BoardCp = { id: number; clanId: number; name: string; members: number; onBoard: boolean };
export type CpPlaced = { parties: number; players: number; skipped: string[] };
export type OpView = {
  id: number;
  name: string;
  eventType?: string | null;
  startsAt: string | null;
  state: OpState;
  eventLeaderId: number;
  deputyIds: number[];
  clans: { id: number; name: string; tag: string }[];
  parties: Party[];
  people: Person[];
  reserveIds: number[];
  /** Players waiting for an answer to "may I join this party?". */
  requests: { partyId: number; userId: number }[];
  /** Who has answered. Players without an answer are not listed. */
  signups?: Signup[];
};
export type OpPerms = { isOrganiser: boolean; leadClanIds: number[]; canView: boolean; canEditParties: boolean };
export type OpDetail = {
  op: OpView;
  perms: OpPerms;
  canRunOp: boolean;
  onlineIds: number[];
  cps: BoardCp[];
  /** Constant parties I lead in this operation's clans, and how many of their members have answered. */
  myCps?: { id: number; name: string; members: number; answered: number }[];
};
/** An earlier operation whose roster a new one can start from. */
export type PreviousOp = { id: number; name: string; state: OpState; startsAt: string | null; eventLeaderId: number; clanIds: number[]; parties: number; players: number };
export type OpOptions = { clans: ClanSummary[]; users: { id: number; name: string; clanTag: string | null }[]; previous: PreviousOp[] };
export type AllianceUser = { id: number; name: string; clanId: number | null; clanTag: string | null; banned: boolean; isAdmin: boolean; isAllianceAdmin: boolean; isOwner?: boolean };
/** A player banned from the alliance. `id` names the ban for lifting it. */
export type Ban = { id: string; name: string; at: string };
export type AllianceView = { plan?: PlanState | null; alliance?: AllianceInfo | null; bans?: Ban[]; loungeOn?: boolean; /** Admins may speak to the whole alliance between operations (decision 64). */ broadcastOn?: boolean; clans: ClanSummary[]; users: AllianceUser[]; /** Whether the alliance's own Discord announcements are set up. */ discord?: boolean; discordRole?: string | null; /** Minutes before an operation's start that Discord is reminded; 0: never. */ remindMinutes?: number; remindChoices?: number[]; /** The operations' text chat: who may write beyond those who may speak, and how long lines are kept. */ chat?: { clanAll: boolean; operationAll: boolean; readyCheck?: boolean; keepDays: number }; /** The alliance's quick calls by slot, and their limits. Absent on a server before 0.24. */ calls?: string[]; callLimits?: { slots: number; max: number }; chatKeepChoices?: number[] };

/** One player's time in voice during an operation. `seconds` is 0 when they never joined. */
export type AttendanceRow = {
  userId: number;
  name: string;
  usualName: string | null;
  className: string | null;
  classTag: string | null;
  levelBand: string | null;
  clanTag: string | null;
  party: string | null;
  signup: "coming" | "out" | null;
  seconds: number;
  firstAt: string | null;
  lastAt: string | null;
};
/** `seconds` is how long the operation ran (so far, while `live`). */
export type Attendance = { from: string | null; to: string | null; live: boolean; seconds: number; rows: AttendanceRow[] };
