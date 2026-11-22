// The sword that shows the app is working: it fills with red from the pommel
// to the tip as something progresses, or, when there is nothing to measure, a
// red light passes along the cold steel. Embers rise from the edge of the fill.
//
// The sword is an original drawing made for this project, like the emblem in art/.

import { d, t } from "../words";
import { useEffect, useId, useRef } from "react";

const VB_W = 1000;
const VB_H = 300;
/** Where the blade ends, in the drawing's own units. */
const TIP = 990;
/** The canvas is larger than the drawing so embers can leave it: this much wider and taller, in parts of the drawing's size. */
const SPILL = { x: 0.12, y: 0.45 };

/** How far above and below the centre line the sword reaches at a point along it. Embers start inside this. */
const halfHeight = (x: number) =>
  x < 62 ? 20 : x < 148 ? 11 : x < 262 ? 14 + ((x - 148) / 114) * 118 : x < 392 ? 132 - ((x - 262) / 130) * 78 : Math.max(2, 56 * (1 - (x - 356) / (TIP - 356)) ** 0.92);

type Ember = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; hot: boolean };

/**
 * `progress` from 0 to 1 fills the sword that far. `null` means "working, but
 * nothing to measure": the sword stays cold and a red light passes along it.
 */
export function SwordLoader({ progress, className = "" }: { progress: number | null; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reveal = useRef<SVGRectElement>(null);
  const front = useRef<SVGRectElement>(null);
  const sheen = useRef<SVGRectElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<number | null>(progress);
  current.current = progress;

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let embers: Ember[] = [];
    let raf = 0;
    let last = performance.now();
    const born = last;
    let wasFull = current.current !== null && current.current >= 1;

    const fit = () => {
      const r = cv.getBoundingClientRect();
      const d = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * d));
      cv.height = Math.max(1, Math.round(r.height * d));
    };
    const wide = 1 + 2 * SPILL.x;
    const tall = 1 + 2 * SPILL.y;
    const at = (x: number, y: number): [number, number] => [((x / VB_W + SPILL.x) / wide) * cv.width, ((y / VB_H + SPILL.y) / tall) * cv.height];
    const spawn = (x: number, n: number, burst: boolean) => {
      const h = halfHeight(x);
      for (let i = 0; i < n; i++) {
        embers.push({
          x: x + (Math.random() - 0.7) * 16,
          y: 150 + (Math.random() * 2 - 1) * h * 0.9,
          vx: burst ? 40 + Math.random() * 190 : (Math.random() - 0.35) * 46,
          vy: burst ? (Math.random() - 0.5) * 210 : (Math.random() < 0.72 ? -1 : 1) * (18 + Math.random() * 62),
          life: 0,
          max: 0.55 + Math.random() * (burst ? 1 : 0.95),
          r: 0.9 + Math.random() * 2.1,
          hot: Math.random() > 0.75,
        });
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = current.current;

      // The fill, and the bright front of it.
      const filled = p === null ? 0 : Math.max(0, Math.min(1, p));
      const x = filled * TIP;
      reveal.current?.setAttribute("width", String(x + 0.5));
      front.current?.setAttribute("x", String(x - 70));
      front.current?.setAttribute("opacity", filled > 0.002 && filled < 0.999 ? "1" : "0");

      // Nothing to measure: one pass of light every 1.9 seconds, hilt to tip.
      const pass = ((now - born) / 1900) % 1;
      if (sheen.current) {
        sheen.current.setAttribute("x", String(-320 + pass * 1500));
        (sheen.current.parentNode as SVGGElement).setAttribute("opacity", p === null ? "1" : "0");
      }

      if (!calm) {
        if (p === null) {
          const sx = -190 + pass * 1500;
          if (sx > 12 && sx < TIP && Math.random() < 0.35) spawn(sx, 1, false);
        } else if (filled > 0.01 && filled < 0.995) {
          spawn(x, Math.random() < 0.75 ? 1 : 2, false);
        }
        // Reaching the tip throws a handful of sparks off it.
        if (filled >= 1 && !wasFull) spawn(TIP - 6, 46, true);
      }
      wasFull = filled >= 1;

      ctx.clearRect(0, 0, cv.width, cv.height);
      if (embers.length) {
        const unit = cv.width / wide / VB_W;
        ctx.globalCompositeOperation = "lighter";
        embers = embers.filter((e) => (e.life += dt) < e.max);
        for (const e of embers) {
          e.vy -= 26 * dt; // heat lifts them
          e.vx *= 1 - 0.9 * dt;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          const k = 1 - e.life / e.max;
          const [cx, cy] = at(e.x, e.y);
          const r = e.r * unit * (0.6 + 0.6 * k) * 3.2;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, `rgba(${e.hot ? "255,214,200" : "255,96,84"},${0.95 * k})`);
          g.addColorStop(0.35, `rgba(196,26,31,${0.6 * k})`);
          g.addColorStop(1, "rgba(196,26,31,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      raf = requestAnimationFrame(frame);
    };

    fit();
    window.addEventListener("resize", fit);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, []);

  const lit = progress !== null;
  const reached = (x: number) => lit && (progress ?? 0) * TIP > x;
  const parts = t(`sw-parts-${d(id)}`);
  const url = (name: string) => `url(#sw-${name}-${id})`;

  return (
    <div className={`relative w-full ${className}`}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={lit ? t(`${d(Math.round((progress ?? 0) * 100))} percent`) : t("Working")}>
        <defs>
          <linearGradient id={`sw-steel-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6a7180" />
            <stop offset=".48" stopColor="#2d313a" />
            <stop offset=".52" stopColor="#262a32" />
            <stop offset="1" stopColor="#555b68" />
          </linearGradient>
          <linearGradient id={`sw-blood-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a0507" />
            <stop offset=".3" stopColor="#8a0c13" />
            <stop offset=".5" stopColor="#cf1d22" />
            <stop offset=".7" stopColor="#8a0c13" />
            <stop offset="1" stopColor="#3a0507" />
          </linearGradient>
          <linearGradient id={`sw-front-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff6a5a" stopOpacity="0" />
            <stop offset=".72" stopColor="#ff5548" stopOpacity=".5" />
            <stop offset="1" stopColor="#ffd9cf" stopOpacity="1" />
          </linearGradient>
          <linearGradient id={`sw-sheen-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#b3121a" stopOpacity="0" />
            <stop offset=".5" stopColor="#e8302c" stopOpacity=".95" />
            <stop offset="1" stopColor="#b3121a" stopOpacity="0" />
          </linearGradient>
          <filter id={`sw-glow-${id}`} x="-10%" y="-60%" width="120%" height="220%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0.12  0 .1 0 0 0  0 0 .12 0 0  0 0 0 .9 0" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* The sword's parts: drawn once, used for the steel, the red fill and the clipping. */}
          <g id={parts}>
            {/* blade */}
            <path d="M328 112 L356 94 C520 107 780 128 990 150 C780 172 520 193 356 206 L328 188 Z" />
            {/* guard, above and below: a horn swept back over the grip, a tall spike, a spur forward along the blade */}
            <path d="M244 136 C232 118 206 94 148 60 C192 64 238 76 276 100 C272 72 268 44 262 14 C286 40 306 66 322 96 C340 84 362 74 392 66 C378 86 362 104 344 124 L344 136 Z" />
            <path d="M244 164 C232 182 206 206 148 240 C192 236 238 224 276 200 C272 228 268 256 262 286 C286 260 306 234 322 204 C340 216 362 226 392 234 C378 214 362 196 344 176 L344 164 Z" />
            {/* boss at the cross */}
            <path d="M236 150 C250 124 300 116 352 150 C300 184 250 176 236 150 Z" />
            {/* collar, grip, neck, pommel */}
            <rect x="222" y="131" width="20" height="38" rx="3" />
            <path d="M70 139 L224 141 L224 159 L70 161 Z" />
            <rect x="56" y="141" width="16" height="18" rx="2" />
            <path d="M40 128 C58 128 62 140 62 150 C62 160 58 172 40 172 C24 172 14 162 12 150 C14 138 24 128 40 128 Z" />
            <path d="M10 150 L22 141 L22 159 Z" />
          </g>
          <clipPath id={`sw-shape-${id}`}>
            <use href={`#${parts}`} />
          </clipPath>
          <clipPath id={`sw-reveal-${id}`}>
            <rect ref={reveal} x="0" y="0" width="0" height={VB_H} />
          </clipPath>
        </defs>

        {/* cold steel */}
        <use href={`#${parts}`} fill={url("steel")} stroke="#7a6638" strokeWidth="1.6" strokeLinejoin="round" />

        {/* the red that fills it, and the bright front of the fill */}
        <g clipPath={url("reveal")}>
          <g filter={url("glow")}>
            <use href={`#${parts}`} fill={url("blood")} />
          </g>
          <g clipPath={url("shape")}>
            <rect ref={front} x="0" y="0" width="70" height={VB_H} fill={url("front")} opacity="0" />
          </g>
        </g>

        {/* working with nothing to measure: a red light passes along the steel */}
        <g clipPath={url("shape")} opacity="0">
          <rect ref={sheen} x="-260" y="-40" width="260" height="380" fill={url("sheen")} transform="skewX(-18)" />
        </g>

        {/* line-work, over both steel and red */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M372 150 L968 150" stroke="#0e1014" strokeOpacity=".75" strokeWidth="2.2" />
          <path d="M372 148.4 L960 148.9" stroke="#fff" strokeOpacity=".22" strokeWidth="1" />
          <path d="M366 108 C520 119 770 136 952 149" stroke="#0e1014" strokeOpacity=".45" strokeWidth="1.3" />
          <path d="M366 192 C520 181 770 164 952 151" stroke="#0e1014" strokeOpacity=".45" strokeWidth="1.3" />
          <g stroke="#c8a45a" strokeOpacity=".7" strokeWidth="1.5">
            <path d="M372 132 C396 118 426 120 452 136 C440 126 420 124 404 130" />
            <path d="M372 168 C396 182 426 180 452 164 C440 174 420 176 404 170" />
            <path d="M462 140 C478 134 496 136 512 144" />
            <path d="M462 160 C478 166 496 164 512 156" />
          </g>
          <g stroke="#c8a45a" strokeOpacity=".6" strokeWidth="1.4">
            <path d="M252 130 C234 112 206 90 166 68" />
            <path d="M292 106 C284 78 276 50 266 26" />
            <path d="M340 122 C352 104 368 88 384 72" />
            <path d="M252 170 C234 188 206 210 166 232" />
            <path d="M292 194 C284 222 276 250 266 274" />
            <path d="M340 178 C352 196 368 212 384 228" />
          </g>
          <path
            d="M84 139.4 L96 160.6 M104 139.6 L116 160.4 M124 139.8 L136 160.2 M144 140 L156 160 M164 140.3 L176 159.7 M184 140.5 L196 159.5 M204 140.8 L214 159.2"
            stroke="#0e1014"
            strokeOpacity=".7"
            strokeWidth="1.6"
          />
          <path d="M226 135 L238 135 M226 165 L238 165" stroke="#c8a45a" strokeOpacity=".7" strokeWidth="1.4" />
        </g>
        {/* stones, at the cross and in the pommel: they light as the red passes them */}
        <path d="M276 150 L294 138 L312 150 L294 162 Z" fill="#14161b" stroke="#c8a45a" strokeWidth="1.4" />
        <path d="M283 150 L294 142.5 L305 150 L294 157.5 Z" fill={reached(294) ? "#ff4336" : "#2a0a0b"} />
        <circle cx="38" cy="150" r="9" fill="#14161b" stroke="#c8a45a" strokeWidth="1.4" />
        <circle cx="38" cy="150" r="5" fill={reached(38) ? "#ff4336" : "#2a0a0b"} />
      </svg>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{ left: `${-SPILL.x * 100}%`, top: `${-SPILL.y * 100}%`, width: `${(1 + 2 * SPILL.x) * 100}%`, height: `${(1 + 2 * SPILL.y) * 100}%` }}
      />
    </div>
  );
}
