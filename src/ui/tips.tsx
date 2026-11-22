// Help on request. Explanations are not attached to the things they explain:
// each one sits behind a small scroll icon (`<Help>`), and shows only when the
// player points at that icon, tabs to it, or clicks it. The text is drawn by
// the single TipLayer at the top of the app, in a fixed position, so it is
// never clipped by a scrolling panel.

import { t } from "../words";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The scroll icon. `text` may contain line breaks. The scroll is drawn here,
 * not taken from any game: a strip of parchment between two rollers, rolled up
 * until it is pointed at.
 */
export function Help({ text, className = "" }: { text: string; className?: string }) {
  return (
    <button type="button" className={`info ${className}`} data-tip={text} aria-label={t("Help")} aria-description={text} onClick={(e) => e.preventDefault()}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <g className="info-page">
          <rect x="5.5" y="4" width="9" height="12" />
          <line x1="7.6" y1="8.4" x2="12.4" y2="8.4" />
          <line x1="7.6" y1="11.6" x2="10.8" y2="11.6" />
        </g>
        <g className="info-roll info-roll-top">
          <rect x="1.5" y="2" width="14" height="3.8" rx="1.9" />
          <circle cx="3.5" cy="3.9" r="0.8" />
        </g>
        <g className="info-roll info-roll-low">
          <rect x="4.5" y="14.2" width="14" height="3.8" rx="1.9" />
          <circle cx="16.5" cy="16.1" r="0.8" />
        </g>
      </svg>
    </button>
  );
}

const SHOW_DELAY_MS = 120;

export function TipLayer() {
  const [target, setTarget] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTarget(null);
    };
    const consider = (node: EventTarget | null, delay: number) => {
      const el = node instanceof Element ? node.closest("[data-tip]") : null;
      if (el === current) return;
      window.clearTimeout(timer);
      current = el;
      setTarget(null);
      if (!el) return;
      timer = window.setTimeout(() => {
        const text = el.getAttribute("data-tip");
        if (text && el.isConnected) setTarget({ text, rect: el.getBoundingClientRect() });
      }, delay);
    };

    const over = (e: PointerEvent) => consider(e.target, SHOW_DELAY_MS);
    // Keyboard users get the same help when they tab onto something.
    const focus = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(":focus-visible")) consider(e.target, SHOW_DELAY_MS);
    };
    // Only when the icon itself loses focus: a click moves focus before it lands.
    const blur = (e: FocusEvent) => {
      if (e.target === current) hide();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    // Clicking or tapping the icon shows its text at once; a press anywhere else puts it away.
    const press = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      if (!el) return hide();
      window.clearTimeout(timer);
      current = el;
      setTarget({ text: el.getAttribute("data-tip") ?? "", rect: el.getBoundingClientRect() });
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Place it under the element, centred, kept inside the window; above if there is no room below.
  useLayoutEffect(() => {
    if (!target || !box.current) return setPos(null);
    const { width, height } = box.current.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(gap, Math.min(window.innerWidth - width - gap, target.rect.left + target.rect.width / 2 - width / 2));
    const below = target.rect.bottom + gap;
    const top = below + height > window.innerHeight - gap ? Math.max(gap, target.rect.top - height - gap) : below;
    setPos({ left, top });
  }, [target]);

  if (!target) return null;
  return (
    <div ref={box} role="tooltip" className="tip" style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
      {target.text}
    </div>
  );
}
