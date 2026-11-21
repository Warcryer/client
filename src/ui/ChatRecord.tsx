// The chat of an operation that has ended, read back on its board by the
// players who were on those nets. Loaded only when asked for.

import { Said } from "./ChatPanel";
import { useState } from "react";
import { rpc } from "../api";
import type { NetKind } from "../settings";
import { t } from "../words";
import { Help } from "./tips";
import { NET_TEXT } from "./net-style";

type Record = { keepDays: number; channels: { room: string; net: NetKind; label: string; lines: { id: number; name: string; tag: string | null; text: string; at: string; quick?: true; /** The line in the reader's language, where it was translated while the operation ran. */ tr?: string }[] }[] };

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function ChatRecord({ opId }: { opId: number }) {
  const [rec, setRec] = useState<Record | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const load = () => {
    setBusy(true);
    setError("");
    rpc<Record>("op.chat", { opId })
      .then(setRec, (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const shown = rec?.channels.find((c) => c.room === room) ?? rec?.channels[0];
  const kept = !rec ? "" : rec.keepDays >= 365 ? t("It is kept for a year after the operation ended.") : rec.keepDays === 0 ? "" : t(`It is kept for ${rec.keepDays} days after the operation ended.`);

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-label="Chat record" data-chat-record>
      <div className="flex items-center gap-2">
        <h2 className="title text-sm text-gold">Chat</h2>
        <Help text={t("What was written during this operation, on the nets you were on when it ended. A party's lines are read by that party only, also afterwards.\nHow long it is kept is your alliance's choice.")} />
        {!rec && <button type="button" className="btn btn-quiet text-sm" disabled={busy} onClick={load}>{busy ? "Loading…" : "Show the chat"}</button>}
      </div>
      {error && <p className="text-danger" role="alert">{error}</p>}
      {rec && rec.channels.length === 0 && <p className="text-text-muted">Nothing was written on your nets, or it is no longer kept.</p>}
      {rec && shown && (
        <>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Chat channels">
            {rec.channels.map((c) => (
              <button
                key={c.room}
                type="button"
                role="tab"
                aria-selected={c.room === shown.room}
                className={`cursor-pointer rounded-sm px-2 text-xs font-semibold uppercase tracking-wider ${c.room === shown.room ? `${NET_TEXT[c.net]} bg-white/10` : "text-text-muted hover:text-text"}`}
                onClick={() => setRoom(c.room)}
              >
                {c.label} <span className="font-normal tabular-nums">{c.lines.length}</span>
              </button>
            ))}
          </div>
          <ol className="max-h-80 overflow-y-auto leading-6" data-chat-record-lines>
            {shown.lines.map((l) => (
              <li key={l.id} className="break-words">
                <span className="text-[11px] tabular-nums text-text-muted">{clock(l.at)} </span>
                <span className="font-semibold text-gold">{l.name}</span>{" "}
                <Said line={l} compact={false} />
              </li>
            ))}
          </ol>
          {kept && <p className="text-xs text-text-muted">{kept}</p>}
        </>
      )}
    </section>
  );
}
