// Clan invite links. A link opened on the invite page arrives here through
// the app's own link scheme (warcryer://join?invite=CODE). It is kept until
// the player is signed in and set up. The app then says which clan it is for
// and asks (ui/InviteAsk); only a yes uses it. The outcome is shown on the
// Clan screen.

import { d, t } from "./words";
import { useSyncExternalStore } from "react";
import { rpc } from "./api";
import { isDesktop, LINK_SCHEME } from "./config";

const KEY = "invite.pending";
export type InviteOutcome = { ok: boolean; text: string };

let pending: string | null = read();
let outcome: InviteOutcome | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function setPending(code: string | null) {
  pending = code;
  try {
    if (code) localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {
    /* kept for this run only */
  }
  changed();
}

export const usePendingInvite = () => useSyncExternalStore(subscribe, () => pending);
export const useInviteOutcome = () => useSyncExternalStore(subscribe, () => outcome);
export function clearInviteOutcome() {
  outcome = null;
  changed();
}

type Redeemed = { clanId: number; clanName: string; status: "active" | "pending" };
const said = (r: Redeemed) =>
  r.status === "active"
    ? t(`Welcome to ${d(r.clanName)}. You are in its lounge now.`)
    : t(`Your request to join ${d(r.clanName)} is in. A leader or officer approves it.`);

/** Uses an invite (a link or a bare code). Resolves with what to tell the player; throws with the reason if it could not be used. */
export async function redeemInvite(text: string): Promise<string> {
  return said(await rpc<Redeemed>("clan.redeemInvite", { code: text }));
}

/** What the server says about the invite that arrived by link: which clan it is for. Throws if it no longer works. */
export type InvitePeek = { clanId: number; clanName: string; clanTag: string; crest: number; autoApprove: boolean; allianceName?: string };
export const peekPending = (): Promise<InvitePeek> => rpc<InvitePeek>("clan.peekInvite", { code: pending ?? "" });

/** Forgets the invite that arrived by link without using it. With `why`, the Clan screen says so. */
export function dropPending(why?: string) {
  if (why) outcome = { ok: false, text: why };
  setPending(null);
}

/** Uses the invite that arrived by link, once. The outcome is kept for the Clan screen. */
export async function redeemPending(): Promise<void> {
  const code = pending;
  if (!code) return;
  setPending(null);
  try {
    outcome = { ok: true, text: await redeemInvite(code) };
  } catch (e) {
    outcome = { ok: false, text: e instanceof Error ? e.message : t("That invite could not be used.") };
  }
  changed();
}

/** Listens for invite links handed to the app by Windows. */
export async function startInviteLinks(): Promise<void> {
  if (!isDesktop) return;
  const { onOpenUrl, getCurrent } = await import("@tauri-apps/plugin-deep-link");
  const handle = (urls: string[] | null) => {
    for (const raw of urls ?? []) {
      try {
        const url = new URL(raw);
        const code = url.searchParams.get("invite");
        if (url.protocol === `${LINK_SCHEME}:` && code && /^[a-z0-9]{8,32}$/i.test(code)) setPending(code.toLowerCase());
      } catch {
        /* not a link for us */
      }
    }
  };
  // The app may have been started by the link itself.
  handle(await getCurrent().catch(() => null));
  await onOpenUrl(handle);
}
