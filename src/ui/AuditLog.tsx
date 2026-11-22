import { t } from "../words";
import { useState } from "react";
import { ApiError, rpc, type AuditEntry } from "../api";
import { Help } from "./tips";
import { startTime } from "./common";

/**
 * The record of who changed what: roster moves, roles, bans, invite links,
 * constant parties. Alliance admins read all of it; a clan's leader reads
 * what concerns the clan. It loads only when asked for, a page at a time.
 */
export function AuditLog({ scope, clanId, title, help }: { scope: "alliance" | "clan"; clanId?: number; title: string; help: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const load = async (before?: number) => {
    setBusy(true);
    setError("");
    try {
      const page = await rpc<{ entries: AuditEntry[]; more: boolean }>("audit.list", { scope, clanId, before });
      setEntries((old) => (before && old ? [...old, ...page.entries] : page.entries));
      setMore(page.more);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const words = filter.trim().toLowerCase();
  const shown = (entries ?? []).filter((e) => !words || `${e.actor ?? t("the server")} ${e.text} ${e.operation ?? ""}`.toLowerCase().includes(words));
  const when = (iso: string) => startTime(iso);

  return (
    <section className="panel p-5 flex flex-col gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="title title-rule flex-1 text-sm text-gold">
          {title}
          <Help text={help} />
        </h2>
        {entries === null ? (
          <button type="button" className="btn btn-quiet text-sm" disabled={busy} onClick={() => void load()}>{busy ? t("Loading…") : t("Show the log")}</button>
        ) : (
          <>
            <input className="field w-48 text-sm" placeholder={t("Filter")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Filter the log")} />
            <button type="button" className="btn btn-quiet text-sm" disabled={busy} onClick={() => void load()}>{t("Refresh")}</button>
            <button type="button" className="btn btn-quiet text-sm" onClick={() => setEntries(null)}>{t("Hide")}</button>
          </>
        )}
      </div>
      {error && <p className="text-danger" role="alert">{error}</p>}
      {entries !== null && (
        <>
          {entries.length === 0 && <p className="text-text-muted">{t("Nothing has been recorded yet.")}</p>}
          {entries.length > 0 && shown.length === 0 && <p className="text-text-muted">{t("Nothing matches that filter.")}</p>}
          <ol className="flex flex-col divide-y divide-line">
            {shown.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                <time className="w-40 shrink-0 text-xs tabular-nums text-text-muted" dateTime={e.at}>{when(e.at)}</time>
                <span className="min-w-0 flex-1">
                  <span className={e.actor === null ? "text-text-muted" : "font-medium"}>{e.actor ?? t("The server")}</span> {e.text}
                  {e.operation && <span className="ml-2 text-xs text-text-muted">{e.operation}</span>}
                </span>
              </li>
            ))}
          </ol>
          {more && (
            <div>
              <button type="button" className="btn btn-quiet text-sm" disabled={busy} onClick={() => void load(entries[entries.length - 1]?.id)}>{busy ? t("Loading…") : t("Older entries")}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
