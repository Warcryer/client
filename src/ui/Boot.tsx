import { d, t } from "../words";
import { useEffect, useRef, useState } from "react";
import { isDesktop } from "../config";
import { getSettings } from "../settings";
import { updateAtStart, useUpdate } from "../update";
import { SwordLoader } from "./SwordLoader";
import { Wordmark } from "./common";

/** How long the opening lasts when the app is first opened. The sword fills over this time. */
const OPENING_MS = 3000;
const FADE_MS = 400;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The opening of the desktop app: a sword that fills while the app gets ready.
 *
 * First a waiting update is installed, before the player joins voice (the
 * sword then shows the download). Otherwise the app starts connecting behind
 * the opening, so the three seconds are not wasted, and the opening lifts when
 * the sword is full. It plays once per start of the app: reconnecting, or
 * coming back from the tray, never shows it. The browser version has none.
 */
export function Boot({ children }: { children: React.ReactNode }) {
  // Players who ask their system for less motion get no opening, only the update check.
  const calm = useRef(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  const [checking, setChecking] = useState(() => isDesktop && getSettings().autoUpdate);
  const [fill, setFill] = useState(0);
  const [gone, setGone] = useState(() => !isDesktop);
  const [fading, setFading] = useState(false);
  const u = useUpdate();
  const born = useRef(performance.now());

  useEffect(() => {
    if (!checking) return;
    void updateAtStart().finally(() => setChecking(false));
  }, [checking]);

  // The sword fills with time. While the update check is still out it stops just short, so it cannot finish early.
  useEffect(() => {
    if (gone) return;
    let raf = 0;
    const tick = (now: number) => {
      const t = calm ? 1 : Math.min(1, (now - born.current) / OPENING_MS);
      setFill(Math.min(ease(t), checking ? 0.92 : 1));
      if (t < 1 || checking) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gone, checking, calm]);

  // Full, and nothing left to wait for: lift the opening.
  const downloading = u.phase === "downloading" || u.phase === "ready" || u.phase === "installing";
  useEffect(() => {
    if (gone || checking || fill < 1) return;
    setFading(true);
    const timer = window.setTimeout(() => setGone(true), calm ? 0 : FADE_MS);
    return () => window.clearTimeout(timer);
  }, [gone, checking, fill, calm]);

  // An update being fetched takes over the sword: it shows the real download.
  const shown = downloading ? (u.phase === "downloading" ? (u.percent ?? 0) / 100 : 1) : fill;
  const caption =
    u.phase === "downloading"
      ? t(`Downloading version ${d(u.version)}${d(u.percent === null ? "…" : `: ${u.percent}%`)}`)
      : u.phase === "ready" || u.phase === "installing"
        ? t(`Installing version ${d(u.version)}. The app will restart by itself.`)
        : checking
          ? t("Checking for updates…")
          : fill < 1
            ? t("Connecting…")
            : t("Ready");

  return (
    <>
      {/* The app starts underneath as soon as there is no update to install first. */}
      {!checking && children}
      {!gone && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0 p-6 transition-opacity"
          style={{ opacity: fading ? 0 : 1, transitionDuration: `${FADE_MS}ms`, background: "radial-gradient(ellipse 80% 70% at 50% 45%, #161922 0%, #0b0c0f 75%) #0b0c0f" }}
          role="status"
          aria-label={t("Starting")}
        >
          <div className="flex w-full max-w-2xl flex-col items-center gap-4 text-center">
            <Wordmark className="text-xl" />
            <SwordLoader progress={shown} />
            <p className="min-h-6 tabular-nums text-text-muted">{caption}</p>
          </div>
        </div>
      )}
    </>
  );
}
