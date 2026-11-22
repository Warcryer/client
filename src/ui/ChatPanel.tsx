// The operation's text chat as a panel: a tab per net the player is on, its
// lines, and one line to write in. The Voice tab shows it, and so does the
// chat window the compact strip opens into; both are handed the same view
// (src/chat.ts) and the same four actions.

import { useEffect, useRef, useState } from "react";
import type { ChatChannel, ChatLineView, ChatView } from "../chat";
import { d, t } from "../words";
import { NET_TEXT } from "./net-style";

export type ChatActions = {
  say(room: string, text: string): void;
  /** Which channel is on screen now; null when the panel goes away. */
  watch(room: string | null): void;
  remove(id: number): void;
  mute(userId: number, on: boolean): void;
  /** Pins an order for the whole operation; empty clears it. For those who run it. */
  order(text: string): void;
  /** Starts a ready check, or ends the one running. For those who run the operation. */
  readyCheck(start: boolean): void;
  /** Answers the ready check on screen. */
  answer(ready: boolean): void;
  /** Sends the alliance's quick call in that slot (1 to 8) into the player's party. */
  call(slot: number): void;
};

const hhmm = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * What a line says. A line translated for this player (server decision 66) is shown in their language with
 * a small mark; the mark is a button that puts the line back as it was written, and back again.
 */
export function Said({ line, compact }: { line: { text: string; tr?: string; quick?: true }; compact: boolean }) {
  const [original, setOriginal] = useState(false);
  const text = line.tr && !original ? line.tr : line.text;
  return (
    <>
      {line.quick ? <span className="font-semibold text-gold-bright">▸ {text}</span> : text}
      {line.tr && (
        <button
          type="button"
          className={`ml-1.5 cursor-pointer align-baseline uppercase tracking-wider text-text-muted hover:text-gold ${compact ? "text-[9px]" : "text-[10px]"}`}
          aria-pressed={original}
          aria-label={original ? t("Show the translation") : t("Show the line as it was written")}
          onClick={() => setOriginal(!original)}
          data-chat-translated={original ? "original" : "translated"}
        >
          {original ? "original" : "translated"}
        </button>
      )}
    </>
  );
}

export function ChatPanel({
  view,
  act,
  compact = false,
  folded = false,
  chatKey,
  onTyping,
  onDone,
  onHandBack,
}: {
  view: ChatView;
  act: ChatActions;
  /** The chat window over the game: smaller, no times, nothing that needs a careful mouse. */
  compact?: boolean;
  /** Folded down on the Voice screen: the order, a ready check and the line to write in stay; the channels and their lines are put away. */
  folded?: boolean;
  /** The chat window only: what the chat key did last (the native side has put the window in front, or says it could not). */
  chatKey?: { how: string; n: number };
  /** The chat window only: the line got or lost the keyboard. */
  onTyping?: (on: boolean) => void;
  /** The chat window only: the line was sent or given up, and the keyboard should go back to the game. */
  onDone?: (sent: boolean) => void;
  /** The chat window only: a button in it was clicked (an answer to a ready check), which took the keyboard from the game. */
  onHandBack?: () => void;
}) {
  const [room, setRoom] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  /** The organiser's next line is the order, not a line. */
  const [pin, setPin] = useState(false);
  /** The alliance's quick calls are laid out for a click. */
  const [callsOpen, setCallsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // A line taken away while it has the keyboard says nothing as it goes: say it for it, or the
  // talk keys stay letters (decided natively, chat.rs).
  const typingNow = useRef(false);
  typingNow.current = typing;
  useEffect(() => {
    if (typing && !input.current) {
      setTyping(false);
      onTyping?.(false);
    }
  });
  useEffect(() => () => void (typingNow.current && onTyping?.(false)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useRef<HTMLOListElement>(null);
  const channel: ChatChannel | undefined = view.channels.find((c) => c.room === room) ?? view.channels[0];
  const lines: ChatLineView[] = channel ? (view.lines[channel.room] ?? []) : [];

  // Whatever channel is on screen counts as read.
  const shown = channel?.room ?? null;
  useEffect(() => {
    act.watch(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  useEffect(() => () => act.watch(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The chat key was pressed. If the window was given the keyboard, the line takes it now.
  useEffect(() => {
    if (!chatKey?.n) return;
    if (chatKey.how === "direct" || chatKey.how === "attach") input.current?.focus();
    else input.current?.blur();
  }, [chatKey]);

  // The newest line stays in view.
  const last = lines.at(-1)?.id;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [last, shown]);

  // A new order stands out for a few seconds.
  const [flash, setFlash] = useState(false);
  const orderAt = view.order?.at;
  useEffect(() => {
    if (!orderAt) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 6000);
    return () => window.clearTimeout(timer);
  }, [orderAt]);
  // While a ready check runs, the seconds left are counted down here.
  const running = view.ready !== null || (view.tally !== null && !view.tally.done);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const left = (endsAt: number | undefined) => (endsAt === undefined ? "" : `${Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))} s`);

  if ((!view.operation && !view.between) || !channel) {
    return (
      <div className={`flex min-h-0 flex-1 items-center justify-center px-3 text-center text-text-muted ${compact ? "text-[12px]" : "text-sm"}`} data-chat="none">
        {t("The chat is for operations. It opens here when you are in one.")}
      </div>
    );
  }

  const done = (sent: boolean) => {
    input.current?.blur();
    onDone?.(sent);
  };
  const cannot = view.muted ? t("Your writing is switched off for this operation. You can still read.") : !channel.write ? t("You read here. You do not write here.") : "";
  // Pinning an order is done from the channel the organisers give their orders on.
  const canPin = view.organises && channel.net === "broadcast" && !cannot;
  const pinning = pin && canPin;
  // Quick calls go to the party (or Reserve); between operations to the group, or the clan's lounge without one
  // (the server's callRoom). That is where they are offered for a click. Keys work on any tab.
  const find = (test: (c: (typeof view.channels)[number]) => boolean) => view.channels.find(test)?.room;
  const callTarget = find((c) => c.net === "party") ?? find((c) => c.net === "reserve") ?? find((c) => c.net === "group") ?? find((c) => c.room.startsWith("lounge-clan-"));
  const canCall = channel.room === callTarget && !cannot && view.calls.some(Boolean);
  const offered = callsOpen && canCall;
  const tally = view.tally;
  const answer = (ready: boolean) => {
    act.answer(ready);
    onHandBack?.();
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${compact ? "text-[13px]" : "text-sm"} ${folded ? "pt-1" : ""}`} data-chat={channel.room}>
      {view.order && (
        <div className={`flex shrink-0 items-baseline gap-2 border-b border-gold-dim/40 px-2 py-0.5 text-net-broadcast transition-colors duration-700 ${flash ? "bg-net-broadcast/20" : ""}`} data-chat-order>
          <span className="min-w-0 flex-1 break-words font-semibold">{view.order.text}</span>
          {!compact && <span className="shrink-0 text-[11px] text-text-muted">{view.order.by}</span>}
          {view.organises && (
            <button type="button" className="shrink-0 cursor-pointer text-[11px] text-text-muted hover:text-danger" onClick={() => act.order("")} aria-label={t("Clear the order")}>
              clear
            </button>
          )}
        </div>
      )}
      {view.ready && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gold-dim/40 bg-gold/10 px-2 py-1" data-ready-ask>
          <span className="font-semibold text-gold-bright">{view.ready.by} asks: ready?</span>
          <button type="button" className="btn px-2 py-0 text-xs" onClick={() => answer(true)}>{t("Ready")}</button>
          <button type="button" className="btn btn-quiet px-2 py-0 text-xs" onClick={() => answer(false)}>{t("Not ready")}</button>
          <span className="ml-auto text-[11px] tabular-nums text-text-muted">{left(view.ready.endsAt)}</span>
        </div>
      )}
      {tally && (
        <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 border-b border-gold-dim/40 px-2 py-0.5 text-[12px]" data-ready-tally={tally.done ? "done" : "running"}>
          <span className="font-semibold text-gold">{t("Ready check")}{tally.done ? "" : ` · ${left(tally.endsAt)}`}</span>
          <span className="text-net-party">{tally.ready} ready</span>
          {tally.notReady > 0 && <span className="text-danger">{tally.notReady} not ready{tally.names ? `: ${tally.names.notReady.join(", ")}` : ""}</span>}
          {tally.waiting > 0 && <span className="text-text-muted">{tally.waiting} no answer{tally.names ? `: ${tally.names.waiting.join(", ")}` : ""}</span>}
          {view.organises && !tally.done && (
            <button type="button" className="ml-auto cursor-pointer text-[11px] text-text-muted hover:text-gold" onClick={() => act.readyCheck(false)}>
              {t("End now")}
            </button>
          )}
        </div>
      )}
      <div className={`shrink-0 flex-wrap items-center gap-1 px-1 pt-1 ${folded ? "hidden" : "flex"}`} role="tablist" aria-label={t("Chat channels")}>
        {view.channels.map((c) => (
          <button
            key={c.room}
            type="button"
            role="tab"
            aria-selected={c.room === channel.room}
            data-chat-tab={c.net}
            className={`cursor-pointer rounded-sm px-2 text-[11px] font-semibold uppercase tracking-wider ${c.room === channel.room ? `${NET_TEXT[c.net]} bg-white/10` : "text-text-muted hover:text-text"}`}
            onClick={() => setRoom(c.room)}
          >
            {c.label}
            {view.unread[c.room] && c.room !== channel.room && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-gold-bright align-middle" role="img" aria-label={t("New lines")} />}
          </button>
        ))}
        {view.organises && view.readyCheck && (!tally || tally.done) && (
          <button type="button" className="ml-auto cursor-pointer rounded-sm border border-gold-dim px-2 text-[11px] text-gold hover:border-gold-bright" onClick={() => act.readyCheck(true)} data-ready-start>
            {t("Ready check")}
          </button>
        )}
      </div>
      <ol ref={list} className={`min-h-0 flex-1 overflow-y-auto px-2 py-1 ${compact ? "leading-[19px]" : "leading-6"} ${folded ? "hidden" : ""}`} data-chat-lines aria-live="polite">
        {lines.length === 0 && <li className="text-[12px] italic text-text-muted">{t("Nothing has been written here yet.")}</li>}
        {lines.map((l) => {
          if (l.userId === null) return <li key={l.id} className="text-[12px] italic text-text-muted" data-chat-note>{t(l.text)}</li>;
          const own = l.userId === view.me;
          const off = view.mutedIds.includes(l.userId);
          return (
            <li key={l.id} className="group break-words" data-chat-line={l.id} data-quick={l.quick ? "" : undefined}>
              {!compact && <span className="text-[11px] tabular-nums text-text-muted">{hhmm(l.at)} </span>}
              <span className={`font-semibold ${own ? "text-gold-bright" : "text-gold"}`}>{l.name}</span>
              {l.tag && !compact && <span className="text-[11px] text-text-muted"> [{l.tag}]</span>}{" "}
              <Said line={l} compact={compact} />
              {(own || view.moderates || view.modRooms.includes(channel.room)) && (
                <span className="ml-2 hidden gap-2 align-middle text-[11px] group-hover:inline-flex group-focus-within:inline-flex">
                  <button type="button" className="cursor-pointer text-text-muted hover:text-danger" onClick={() => act.remove(l.id)} aria-label={t(`Remove this line of ${d(l.name)}`)}>
                    remove
                  </button>
                  {view.moderates && !own && (
                    <button type="button" className="cursor-pointer text-text-muted hover:text-danger" onClick={() => act.mute(l.userId as number, !off)} aria-label={off ? t(`Let ${d(l.name)} write again`) : t(`Switch off ${d(l.name)}'s writing`)}>
                      {off ? t("let write") : t("switch off")}
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {offered && (
        <div className="flex shrink-0 flex-wrap gap-1 border-t border-line px-1 py-1" data-calls>
          {view.calls.map((call, i) =>
            call ? (
              <button
                key={i}
                type="button"
                className="cursor-pointer rounded-sm border border-gold-dim px-2 py-0.5 text-[11px] text-gold hover:border-gold-bright"
                onClick={() => {
                  act.call(i + 1);
                  onHandBack?.();
                }}
                data-call={i + 1}
              >
                {call}
              </button>
            ) : null,
          )}
        </div>
      )}
      <form
        className="flex shrink-0 items-center gap-1 px-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          const said = text.trim();
          if (said && pinning) act.order(said);
          else if (said && !cannot) act.say(channel.room, said);
          setText("");
          setPin(false);
          done(!!said);
        }}
      >
        <input
          ref={input}
          className={`min-w-0 flex-1 rounded-sm border bg-black/40 px-2 py-0.5 text-text outline-none disabled:opacity-60 ${typing ? "border-gold-bright" : "border-line"}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            setTyping(true);
            onTyping?.(true);
          }}
          onBlur={() => {
            setTyping(false);
            onTyping?.(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              done(false);
            }
          }}
          maxLength={300}
          readOnly={!!cannot}
          placeholder={cannot || (pinning ? t("The order, pinned for everyone on the operation") : typing && onDone ? t("Enter sends, Esc gives up") : t(`Write to ${d(channel.label)}`))}
          aria-label={t("Chat line")}
          autoComplete="off"
          spellCheck={false}
        />
        {canCall && (
          <button
            type="button"
            className={`shrink-0 cursor-pointer rounded-sm border px-2 py-0.5 text-[11px] ${offered ? "border-gold text-gold" : "border-line text-text-muted hover:text-text"}`}
            aria-expanded={offered}
            onClick={() => setCallsOpen(!callsOpen)}
            data-calls-toggle
          >
            {t("Calls")}
          </button>
        )}
        {canPin && (
          <button
            type="button"
            className={`shrink-0 cursor-pointer rounded-sm border px-2 py-0.5 text-[11px] ${pinning ? "border-net-broadcast text-net-broadcast" : "border-line text-text-muted hover:text-text"}`}
            aria-pressed={pinning}
            onClick={() => {
              setPin(!pin);
              input.current?.focus();
            }}
            data-chat-pin
          >
            {t("Pin as order")}
          </button>
        )}
      </form>
    </div>
  );
}
