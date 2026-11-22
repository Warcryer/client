// One place for everything that differs between the desktop app, the web
// fallback and a test setup.

export const isDesktop = "__TAURI_INTERNALS__" in window;

/** Shown in the UI. As a sentence to translate it is not shown: the name stays. */
export const APP_NAME: string = import.meta.env.VITE_APP_NAME ?? "Warcryer";

/** The site. In the browser the client is served from it, so it is simply our own origin. */
export const SERVER: string = (isDesktop ? (import.meta.env.VITE_SERVER ?? "https://app.warcryer.org") : location.origin).replace(/\/$/, "");

/**
 * Where the control service is reached, in order of preference. On the hosted
 * service the first is the voice host, which players reach directly; the
 * second is the site's own address, which is behind a CDN. Long-lived
 * connections through the CDN were being cut every few minutes, so that way
 * in is only the fallback: the app uses it when the direct one does not answer.
 * (The server's STATUS, decision 50; the warcryer.org names since decision 56.
 * The old names stay in the list for builds pointed at them with VITE_SERVER.)
 */
const VIA_SITE = `${SERVER.replace(/^http/, "ws")}/control`;
const DIRECT: Record<string, string> = {
  "app.warcryer.org": "wss://rtc.warcryer.org/control",
  "ignite.v1rtopia.com": "wss://ignite-rtc.v1rtopia.com/control",
};
export const CONTROL_URLS: string[] = import.meta.env.VITE_CONTROL_URL
  ? [import.meta.env.VITE_CONTROL_URL]
  : [...(DIRECT[new URL(SERVER).hostname] ? [DIRECT[new URL(SERVER).hostname]] : []), VIA_SITE];

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";
/** Empty for a release; "test 665ae94" for a test build. */
export const BUILD_LABEL: string = import.meta.env.VITE_BUILD_LABEL ?? "";
/** The version as the player is shown it. */
export const VERSION_TEXT = BUILD_LABEL ? `${APP_VERSION} (${BUILD_LABEL})` : APP_VERSION;

/** The guides, kept beside the client's source. */
export const DOCS_URL = "https://github.com/Warcryer/client/blob/main/docs";

/** Link scheme that brings a browser sign-in back to the desktop app. */
export const LINK_SCHEME = "warcryer";

/** The service's terms of use and privacy policy, on the website (copied there from this repository, where their history can be seen). */
export const TERMS_URL = "https://warcryer.org/terms/";
export const PRIVACY_URL = "https://warcryer.org/privacy/";

/** Where to reach whoever runs the service: its Discord. The only contact there is. */
export const SUPPORT_URL = "https://discord.gg/qf4meEMfhp";

/** The service's own page saying whether it is working right now. */
export const STATUS_URL = `${SERVER}/status`;
