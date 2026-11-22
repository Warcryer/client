// Sign-in. The browser fallback is signed in by the site's own cookie. The
// desktop app signs in through the system browser: it keeps a secret, sends
// only its SHA-256 along, and gets back a one-time code that is worthless
// without the secret. So a sign-in link someone else sends you cannot hand
// them your account.

import { t } from "./words";
import { isDesktop, LINK_SCHEME, SERVER } from "./config";
import { code } from "./i18n";

const TOKEN_KEY = "session";
const VERIFIER_KEY = "signin.verifier";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Opens the system browser at the Discord sign-in. */
export async function beginSignIn(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest(code("SHA-256"), new TextEncoder().encode(verifier))));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const url = `${SERVER}/api/auth/discord/login?desktop=${challenge}`;
  if (isDesktop) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** Trades the one-time code for a session. Throws with a message for the player. */
export async function redeem(code: string): Promise<string> {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error(t("Start the sign-in from this app first."));
  const res = await fetch(`${SERVER}/api/auth/desktop/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), verifier }),
  });
  if (!res.ok) throw new Error(t("That sign-in code is not valid or has expired. Try signing in again."));
  const { token } = (await res.json()) as { token: string };
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(VERIFIER_KEY);
  return token;
}

/** Calls back with the code when the browser hands the sign-in back through the app's link. */
export async function onSignInLink(cb: (code: string) => void): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { onOpenUrl, getCurrent } = await import("@tauri-apps/plugin-deep-link");
  const handle = (urls: string[] | null) => {
    for (const raw of urls ?? []) {
      try {
        const url = new URL(raw);
        const code = url.searchParams.get("code");
        if (url.protocol === `${LINK_SCHEME}:` && code) cb(code);
      } catch {
        /* not a link for us */
      }
    }
  };
  // The app may have been started by the link itself.
  handle(await getCurrent().catch(() => null));
  return onOpenUrl(handle);
}

export async function signOut(): Promise<void> {
  const token = getToken();
  localStorage.removeItem(TOKEN_KEY);
  if (token) {
    await fetch(`${SERVER}/api/auth/desktop/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }
}
