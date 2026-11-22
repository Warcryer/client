// Who was in voice during an operation and for how long: for the organisers,
// and for clan leadership about their own members. The server works it out
// from the joins and leaves it already records; the copy button gives the
// table as tab-separated text, which pastes straight into a spreadsheet.

import { d, t } from "../words";
import { useState } from "react";
import { rpc, type Attendance, type AttendanceRow } from "../api";
import { useLoad } from "./app-context";
import { Help } from "./tips";
import { tx } from "../i18n";
import { clock, span } from "./common";

const share = (row: AttendanceRow, total: number) => (total > 0 ? Math.min(100, Math.round((row.seconds / total) * 100)) : 0);

// Labels: t() where shown.
const SORTS = {
  clan: { label: "Clan, then name", by: null },
  time: { label: "Most time first", by: (a: AttendanceRow, b: AttendanceRow) => b.seconds - a.seconds || a.name.localeCompare(b.name) },
  party: { label: "Party", by: (a: AttendanceRow, b: AttendanceRow) => Number(a.party === null) - Number(b.party === null) || (a.party ?? "").localeCompare(b.party ?? "") || a.name.localeCompare(b.name) },
} as const;

/**
 * One cell of the copied table. A party's name is whatever its leader typed, and a spreadsheet runs a
 * cell that starts with = + - or @ as a formula, so such text is given a leading apostrophe, which
 * spreadsheets show as plain text. Tabs and line breaks would shift the columns, so they become spaces.
 */
const cell = (v: string | number) => (typeof v === "number" ? String(v) : (/^[=+\-@]/.test(v) ? "'" : "") + v.replace(/[\t\r\n]+/g, " "));

/** The table as text a spreadsheet takes: one line per player, columns separated by tabs. */
function asText(a: Attendance, rows: AttendanceRow[]): string {
  const head = [t("Name"), t("Usual name"), t("Class"), t("Level"), t("Clan"), t("Party"), t("Minutes in voice"), t("Percent of operation"), t("Joined"), t("Left"), t("Signed up")];
  const lines = rows.map((r) =>
    [r.name, r.usualName ?? "", r.className ?? "", r.levelBand ?? "", r.clanTag ?? "", r.party ?? "", Math.round(r.seconds / 60), share(r, a.seconds), clock(r.firstAt), clock(r.lastAt), r.signup === "coming" ? t("Coming") : r.signup === "out" ? t("Can't come") : ""].map(cell).join("\t"),
  );
  return [head.join("\t"), ...lines].join("\n");
}

export function AttendancePanel({ opId, live }: { opId: number; live: boolean }) {
  // While the operation runs this is a look at "so far", kept closed until asked for.
  const [open, setOpen] = useState(!live);
  const [sort, setSort] = useState<keyof typeof SORTS>("clan");
  const [copied, setCopied] = useState(false);
  const { data, error } = useLoad(() => (open ? rpc<Attendance>("op.attendance", { opId }) : Promise.resolve(null)), [opId, open], live ? 30_000 : 300_000);

  if (!open) {
    return (
      <div>
        <button type="button" className="btn btn-quiet text-sm" onClick={() => setOpen(true)}>{t("Attendance so far")}</button>
      </div>
    );
  }
  const by = SORTS[sort].by;
  const rows = data ? (by ? [...data.rows].sort(by) : data.rows) : [];
  const came = rows.filter((r) => r.seconds > 0).length;
  const copy = () => {
    if (!data) return;
    void navigator.clipboard.writeText(asText(data, rows)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 4000);
    });
  };

  return (
    <div className="panel flex flex-col gap-3 p-3" data-attendance>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="title flex items-center gap-1 text-sm text-gold-bright">
          {t("Attendance")}
          <Help text={t("Who was in voice while the operation ran, from Start operation to End operation.\nIn voice: the time the player was connected to the operation's nets. Time before it started does not count.\nNo show: the player said they were coming and was never in voice.\nCopy: puts the table on your clipboard as text. Paste it into a spreadsheet and it lands in columns.\nOrganisers see everyone; clan leaders and officers see their own clan.")} />
        </h2>
        {data && (
          <span className="text-text-muted" data-attendance-summary>
            {live ? t(`Running for ${d(span(data.seconds))}`) : t(`Ran for ${d(span(data.seconds))}`)} · {tx(`{came} of ${d(rows.length)} in voice`, { came: <span className="text-net-party">{came}</span> })}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {copied && <span className="text-net-party" role="status">{t("Copied. Paste it into your sheet.")}</span>}
          <select className="field w-auto py-0.5" value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)} aria-label={t("Sort attendance by")}>
            {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{t(s.label)}</option>)}
          </select>
          <button type="button" className="btn text-sm" disabled={!data || rows.length === 0} onClick={copy}>{t("Copy for a spreadsheet")}</button>
          {live && <button type="button" className="text-text-muted hover:text-text cursor-pointer" onClick={() => setOpen(false)}>{t("Close")}</button>}
        </span>
      </div>
      {error && !data && <p className="text-danger">{error}</p>}
      {!data && !error && <p className="text-text-muted">{t("Loading…")}</p>}
      {data && rows.length === 0 && <p className="text-text-muted">{t("Nobody to list.")}</p>}
      {data && rows.length > 0 && (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-bg-1 text-xs uppercase tracking-wider text-text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">{t("Player")}</th>
                <th className="py-1 pr-3 font-normal">{t("Class")}</th>
                <th className="py-1 pr-3 font-normal">{t("Clan")}</th>
                <th className="py-1 pr-3 font-normal">{t("Party")}</th>
                <th className="py-1 pr-3 font-normal">{t("In voice")}</th>
                <th className="py-1 pr-3 font-normal">{t("Joined")}</th>
                <th className="py-1 font-normal">{t("Signed up")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = share(r, data.seconds);
                const noShow = r.seconds === 0 && r.signup === "coming";
                return (
                  <tr key={r.userId} className={`border-t border-line/60 ${r.seconds === 0 ? "text-text-muted" : ""}`} data-attended={r.seconds > 0 ? "yes" : "no"}>
                    <td className="py-1 pr-3">
                      <span className={r.seconds > 0 ? "font-medium" : ""}>{r.name}</span>
                      {r.usualName && <span className="text-text-muted"> ({r.usualName})</span>}
                    </td>
                    <td className="py-1 pr-3">
                      {r.classTag && <span className="text-xs text-gold">{r.classTag}</span>}
                      {r.levelBand && <span className="ml-1 text-xs text-text-muted tabular-nums">{r.levelBand}</span>}
                    </td>
                    <td className="py-1 pr-3 text-text-muted">{r.clanTag ?? ""}</td>
                    <td className="py-1 pr-3 text-text-muted">{r.party ?? t("Reserve")}</td>
                    <td className="py-1 pr-3 tabular-nums">
                      {r.seconds > 0 ? (
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-1.5 w-16 rounded-sm bg-line" role="img" aria-label={t(`${d(pct)} percent of the operation`)}>
                            <span className="block h-full rounded-sm bg-net-party" style={{ width: `${pct}%` }} />
                          </span>
                          {span(r.seconds)} <span className="text-text-muted">{pct}%</span>
                        </span>
                      ) : noShow ? (
                        <span className="text-danger">{t("No show")}</span>
                      ) : (
                        t("Not in voice")
                      )}
                    </td>
                    <td className="py-1 pr-3 tabular-nums text-text-muted">{clock(r.firstAt)}</td>
                    <td className="py-1 text-text-muted">{r.signup === "coming" ? t("Coming") : r.signup === "out" ? t("Can't come") : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
