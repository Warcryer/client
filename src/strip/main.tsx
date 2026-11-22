// The compact strip: a small always-on-top window with one line per net that
// has someone speaking. It holds no connection of its own; the main window
// sends it what to show.
//
// It can open into the chat window: the operation's text chat (ui/ChatPanel),
// in a window that can be sized and made see-through, so that it can sit on
// the game where the game's own chat box was. A chat key (Settings, Keys)
// puts the keyboard in its line; Enter sends and gives the keyboard back.
import { rememberedLanguage, setLanguage, useLanguage } from "../i18n";
import { d, t } from "../words";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NET_TEXT } from "../ui/net-style";
import type { ChatView } from "../chat";
import { AudioToggles } from "../ui/AudioToggles";
import { ChatPanel, type ChatActions } from "../ui/ChatPanel";
import { loadPrefs, PREFS_KEY, savePrefs, STRIP_W, type ChatPrefs } from "./prefs";
import { CHANNEL, POSITION_KEY, type FromStrip, type StripState, type ToStrip } from "./feed";

const NO_CHAT: ChatView = { operation: null, between: false, modRooms: [], channels: [], lines: {}, unread: {}, moderates: false, muted: false, mutedIds: [], me: null, organises: false, readyCheck: false, order: null, ready: null, tally: null, calls: [], called: null };
const invoke = (cmd: string, args?: Record<string, unknown>) =>
  import("@tauri-apps/api/core").then(({ invoke }) => invoke<unknown>(cmd, args)).catch(() => undefined);
const LINE = 22;
const PADDING = 12;
/** With nothing heard from the main window for this long, say so rather than show stale names. */
const STALE_MS = 4000;

function Strip() {
  useLanguage();
  const [state, setState] = useState<StripState | null>(null);
  const [stale, setStale] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const last = useRef(0);
  // The chat window the strip opens into: whether it is open, its size and how see-through it is.
  const [prefs, setPrefs] = useState<ChatPrefs>(loadPrefs);
  // The sizes the player gave: the chat window's, and the folded strip's width. Only the player changes them.
  const size = useRef({ w: prefs.w, h: prefs.h, sw: prefs.sw });
  /** Whether the window is open as the chat window now, as last set here (null: not set yet). */
  const shape = useRef<boolean | null>(null);
  /** Set while this window is changing its own size, so that it is not taken for the player's. */
  const sizing = useRef(false);
  /** What the chat key did last, and a count so that the same answer twice is still news. */
  const [key, setKey] = useState({ how: "", n: 0 });
  const change = (patch: Partial<ChatPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch, ...size.current };
      savePrefs(next);
      return next;
    });

  // The chat key (Settings, Keys). The native side has already put this window in front, or says it could not.
  useEffect(() => {
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ how: string }>("chat-key", (e) => {
          if (e.payload.how === "direct" || e.payload.how === "attach") change({ open: true });
          setKey((k) => ({ how: e.payload.how, n: k.n + 1 }));
        }),
      )
      .then((un) => (off = un))
      .catch(() => {});
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The main window can ask for the chat to be opened (its "Open as a window" button): it writes the same
  // setting, and a change made in another window of the app is announced here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefs((p) => ({ ...p, open: loadPrefs().open }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // The window is whatever size the player drags it to: open, both ways; folded, its width. Remember it.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      if (sizing.current) return;
      size.current = prefs.open
        ? { ...size.current, w: window.innerWidth, h: window.innerHeight }
        : { ...size.current, sw: Math.min(STRIP_W.max, Math.max(STRIP_W.min, window.innerWidth)) };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => savePrefs({ ...prefs, ...size.current }), 400);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, [prefs]);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<ToStrip>) => {
      if (e.data?.type !== "state") return;
      last.current = Date.now();
      setStale(false);
      setState(e.data.state);
      // The strip has its own copy of the app's sentences: it shows them in the language the main window is in.
      if (e.data.state.lang) void setLanguage(e.data.state.lang === "en" ? null : e.data.state.lang);
    };
    ch.postMessage({ type: "hello" } satisfies FromStrip);
    const timer = window.setInterval(() => {
      if (Date.now() - last.current > STALE_MS) {
        setStale(true);
        ch.postMessage({ type: "hello" } satisfies FromStrip);
      }
      // Remember where the strip sits, for the next time it is opened.
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify({ x: window.screenX, y: window.screenY }));
      } catch {
        /* not remembered */
      }
    }, 1500);
    return () => {
      window.clearInterval(timer);
      ch.close();
    };
  }, []);

  // The chat window has no connection: what the player does in it is done by the main window.
  const act: ChatActions = {
    say: (room, text) => channel.current?.postMessage({ type: "chat-say", room, text } satisfies FromStrip),
    watch: (room) => channel.current?.postMessage({ type: "chat-watch", room } satisfies FromStrip),
    remove: (id) => channel.current?.postMessage({ type: "chat-remove", id } satisfies FromStrip),
    mute: (userId, on) => channel.current?.postMessage({ type: "chat-mute", userId, on } satisfies FromStrip),
    order: (text) => channel.current?.postMessage({ type: "chat-order", text } satisfies FromStrip),
    readyCheck: (start) => channel.current?.postMessage({ type: "ready-check", start } satisfies FromStrip),
    answer: (ready) => channel.current?.postMessage({ type: "ready-answer", ready } satisfies FromStrip),
    call: (slot) => channel.current?.postMessage({ type: "chat-call", slot } satisfies FromStrip),
  };
  const chatNow = !stale && state?.chat ? state.chat : NO_CHAT;
  // Folded, the strip still shows the order that stands and asks a ready check: neither should need the chat open.
  const answer = (ready: boolean) => {
    act.answer(ready);
    void invoke("chat_return");
  };
  const lines = !stale && state ? state.lines : [];
  const rows = Math.max(1, lines.length) + (state?.locked && !stale ? 1 : 0) + (chatNow.order ? 1 : 0) + (chatNow.ready ? 1 : 0) + (chatNow.called ? 1 : 0);

  // Open, the window is the size the player gave it, set once as it opens and then left alone: what
  // happens in the chat (a call, an order, someone speaking) never resizes it. Folded, it is as tall as
  // what it shows, as wide as the player made it, and only its width can be dragged.
  useEffect(() => {
    // The sizes to set, read now: changing the limits below resizes the window on the way.
    const want = { ...size.current };
    const open = prefs.open;
    if (open && shape.current === true) return;
    shape.current = open;
    void (async () => {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      sizing.current = true;
      try {
        await w.setResizable(true);
        if (open) {
          await w.setMaxSize(null);
          await w.setMinSize(new LogicalSize(260, 170));
          await w.setSize(new LogicalSize(want.w, want.h));
        } else {
          const h = rows * LINE + PADDING;
          await w.setMinSize(null);
          await w.setMaxSize(null);
          await w.setSize(new LogicalSize(want.sw, h));
          await w.setMinSize(new LogicalSize(STRIP_W.min, h));
          await w.setMaxSize(new LogicalSize(STRIP_W.max, h));
        }
      } finally {
        // The resize events of these changes arrive after them; let them pass before listening again.
        window.setTimeout(() => (sizing.current = false), 300);
      }
    })().catch(() => {});
  }, [rows, prefs.open]);

  const drag = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startDragging()).catch(() => {});
  };
  const openMain = () => void import("@tauri-apps/api/core").then(({ invoke }) => invoke("show_main_window")).catch(() => {});
  const grip = (e: React.MouseEvent, side: "SouthEast" | "East" | "West") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startResizeDragging(side)).catch(() => {});
  };
  const toggle = (
    <button
      type="button"
      className="shrink-0 cursor-pointer px-1 text-text-muted hover:text-text"
      aria-label={prefs.open ? t("Close the chat") : t("Open the chat")}
      aria-expanded={prefs.open}
      data-chat-toggle
      onClick={() => change({ open: !prefs.open })}
    >
      {prefs.open ? "▴" : "▾"}
      {!prefs.open && !stale && Object.values(state?.chat?.unread ?? {}).some(Boolean) && (
        <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-bright align-middle" role="img" aria-label={t("New lines in the chat")} />
      )}
    </button>
  );

  const controls = (
    <>
      {prefs.open && (
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.05}
          value={prefs.alpha}
          onChange={(e) => change({ alpha: Number(e.target.value) })}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-14 shrink-0 cursor-pointer"
          aria-label={t("How see-through the chat is")}
        />
      )}
      {!stale && state?.where && (
        <AudioToggles
          small
          micOff={state.muted}
          headsetOff={state.deafened === true}
          onMic={() => channel.current?.postMessage({ type: "mic-toggle" } satisfies FromStrip)}
          onHeadset={() => channel.current?.postMessage({ type: "headset-toggle" } satisfies FromStrip)}
        />
      )}
      {toggle}
      <Close channel={channel} />
    </>
  );

  return (
    <div
      className="relative flex h-full flex-col border border-gold-dim text-[13px]"
      style={{ background: prefs.open ? `rgba(11, 12, 15, ${prefs.alpha})` : "var(--color-bg-0)" }}
    >
    {/* The buttons sit in their own corner, top right, and stay there: who is speaking comes and goes beside
        them, and a button that moved or was rebuilt under the pointer as a voice line came would miss the click. */}
    <div
      className={`flex cursor-grab select-none items-start gap-2 px-2 leading-[22px] ${prefs.open ? "shrink-0 py-0.5" : "pt-[5px]"}`}
      onMouseDown={drag}
      onDoubleClick={openMain}
    >
    <div className="flex min-w-0 flex-1 flex-col" role="status" aria-label={t("Who is speaking")}>
      {state?.locked && !stale && <div className="truncate font-semibold text-net-broadcast">{t("Broadcast locked open")}</div>}
      {lines.length === 0 ? (
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stale || !state?.where ? "bg-line" : state.muted || state.deafened ? "bg-danger" : "bg-net-party"}`} />
          <span className="min-w-0 flex-1 truncate text-text-muted">
            {stale || !state ? t("Waiting for the app…") : !state.where ? t("Not in voice") : state.deafened ? t(`Headset off · ${d(state.where)}`) : state.muted ? t(`Mic muted · ${d(state.where)}`) : t(`Quiet · ${d(state.where)}`)}
          </span>
        </div>
      ) : (
        lines.map((line) => (
          <div key={`${line.net}-${line.label}`} className={`flex items-center gap-2 ${line.lowered ? "opacity-60" : ""}`}>
            <span className={`w-[5.5rem] shrink-0 truncate text-[11px] font-semibold uppercase tracking-wider max-[300px]:w-14 max-[240px]:w-9 ${NET_TEXT[line.net]}`}>
              {line.short}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {line.you && <span className={`mr-1 font-semibold ${NET_TEXT[line.net]}`}>{t("You")}</span>}
              {line.speakers.map((sp, n) => (
                <span key={`${sp.name}-${n}`} className="mr-1.5 inline-flex items-center gap-1 align-middle">
                  {sp.crest ? <img src={sp.crest} alt="" className="h-3.5 w-3.5 object-contain" /> : sp.tag ? <span className="text-[11px] text-text-muted">[{sp.tag}]</span> : null}
                  {sp.name}
                </span>
              ))}
            </span>
          </div>
        ))
      )}
    </div>
    <div className="flex h-[22px] shrink-0 items-center" data-strip-controls>{controls}</div>
    </div>
    {!prefs.open && chatNow.order && (
      <div className="truncate px-2 font-semibold leading-[22px] text-net-broadcast" data-strip-order>{chatNow.order.text}</div>
    )}
    {!prefs.open && chatNow.called && (
      <div className="truncate px-2 leading-[22px]" data-strip-call>
        <span className="font-semibold text-gold">{chatNow.called.own ? t("You") : chatNow.called.name}</span>{" "}
        <span className="font-semibold text-gold-bright">▸ {chatNow.called.text}</span>
      </div>
    )}
    {!prefs.open && chatNow.ready && (
      <div className="flex items-center gap-2 px-2 leading-[22px]" data-strip-ready>
        <span className="min-w-0 flex-1 truncate font-semibold text-gold-bright">{t(`${d(chatNow.ready.by)}: ready?`)}</span>
        <button type="button" className="cursor-pointer rounded-sm border border-gold px-1.5 text-[11px] leading-4 text-gold-bright" onClick={() => answer(true)}>{t("Ready")}</button>
        <button type="button" className="cursor-pointer rounded-sm border border-line px-1.5 text-[11px] leading-4 text-text-muted" onClick={() => answer(false)}>{t("Not")}</button>
      </div>
    )}
    {!prefs.open && (
      <>
        {/* The folded strip's edges: drag either to make it narrower or wider. */}
        <div className="absolute inset-y-0 left-0 w-1 cursor-ew-resize" onMouseDown={(e) => grip(e, "West")} aria-hidden data-strip-grip="left" />
        <div className="absolute inset-y-0 right-0 w-1 cursor-ew-resize" onMouseDown={(e) => grip(e, "East")} aria-hidden data-strip-grip="right" />
      </>
    )}
    {prefs.open && (
      <>
        <ChatPanel
          view={chatNow}
          act={act}
          compact
          chatKey={key}
          onTyping={(on) => void invoke("chat_typing", { on })}
          onDone={() => void invoke("chat_done")}
          onHandBack={() => void invoke("chat_return")}
        />
        <div className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize" onMouseDown={(e) => grip(e, "SouthEast")} aria-hidden data-chat-grip />
      </>
    )}
    </div>
  );
}

function Close({ channel }: { channel: React.RefObject<BroadcastChannel | null> }) {
  return (
    <button
      type="button"
      className="shrink-0 cursor-pointer px-1 text-text-muted hover:text-text"
      aria-label={t("Close the strip")}
      onClick={() => channel.current?.postMessage({ type: "close" } satisfies FromStrip)}
    >
      ×
    </button>
  );
}

// The window itself is see-through (tauri.conf.json); only what is drawn here covers the game.
for (const el of [document.documentElement, document.body, document.getElementById("root")!]) el.style.background = "transparent";
// The language chosen last time, until the main window says which it is in now.
void setLanguage(rememberedLanguage());
// not shown: the strip has no title bar.
document.title = "Compact strip";
createRoot(document.getElementById("root")!).render(<Strip />);
