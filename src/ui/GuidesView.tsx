// The guides, inside the app. They are the same files as in the repository's
// docs folder, built into the app, so they always match the installed version
// and open without a browser.

import { useGame } from "../game";
import { d, t } from "../words";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import admins from "../../docs/alliance-admins.md?raw";
import firstHour from "../../docs/first-hour.md?raw";
import leaders from "../../docs/clan-leaders.md?raw";
import members from "../../docs/members.md?raw";
import { DOCS_URL } from "../config";
import { useApp } from "./app-context";
import { openInBrowser } from "./common";

// Labels and descriptions: t() where shown.
const GUIDES = [
  { file: "members.md", label: "Members", who: "Everyone: signing in, class and level, invite links, talking, keys, signing up for events, the compact strip, loot, updates, settings", text: members },
  { file: "clan-leaders.md", label: "Clan leaders and officers", who: "Approving members, invite links, officers, the crest, constant parties, your parties in an operation, Discord announcements, attendance, the clan's own points, loot, the clan log", text: leaders },
  { file: "first-hour.md", label: "Your alliance's first hour", who: "For whoever starts an alliance: from installing to a first planned operation, step by step", text: firstHour },
  { file: "alliance-admins.md", label: "Alliance admins and event leaders", who: "Clans, game setup, operations and changing them, who is coming, what each party needs, the roster board, briefings, attendance, points, loot and reading loot screenshots, bans, the log", text: admins },
] as const;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** Raw HTML in the Markdown, as a block or inside a line, comes out as the characters that were typed. */
const PLAIN_HTML = new marked.Renderer();
PLAIN_HTML.html = ({ text }) => escapeHtml(text);

const slug = (text: string) => text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");

export function GuidesView() {
  const { info } = useApp();
  const role = info.membership?.status === "active" ? info.membership.role : null;
  // The guide that matches what this player does is marked, not forced.
  const yours = new Set<string>(["members.md", ...(role === "leader" || role === "officer" ? ["clan-leaders.md"] : []), ...(info.user.runsAlliance ? ["first-hour.md", "alliance-admins.md"] : [])]);
  const [file, setFile] = useState<string>("members.md");
  const page = useRef<HTMLDivElement>(null);
  const guide = GUIDES.find((g) => g.file === file) ?? GUIDES[0];
  // The text is this app's own, built in at compile time. Even so, HTML written into a guide is shown
  // as text, not run: the guides are Markdown, and a change to one must never be a way to put script in the app.
  // The guides are written in the app's own words and read in the alliance's. Link addresses and
  // anything in code type are left as written.
  const game = useGame();
  const said = useMemo(() => t(guide.text.replace(/(\]\([^)\s]*\)|`[^`\n]*`)/g, (m) => d(m))), [guide, game]);
  const html = useMemo(() => marked.parse(said, { async: false, gfm: true, renderer: PLAIN_HTML }), [said]);
  // A heading is found by the name it has in the guide as written, which is what the links in the guides use.
  const anchors = useMemo(() => marked.lexer(guide.text).flatMap((tok) => (tok.type === "heading" && (tok.depth === 2 || tok.depth === 3) ? [slug(tok.text)] : [])), [guide]);

  useEffect(() => {
    const el = page.current;
    if (!el) return;
    el.scrollTop = 0;
    el.querySelectorAll("h2, h3").forEach((h, i) => (h.id = anchors[i] ?? slug(h.textContent ?? "")));
  }, [html, anchors]);

  /** Links stay in the app where they can: another guide, or a heading on this page. */
  const follow = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href) return;
    e.preventDefault();
    if (href.startsWith("#")) return void page.current?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const other = GUIDES.find((g) => href === g.file || href.startsWith(`${g.file}#`));
    if (other) return setFile(other.file);
    void openInBrowser(new URL(href, `${DOCS_URL}/${guide.file}`).toString());
  };

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <nav className="flex w-64 shrink-0 flex-col gap-2" aria-label={t("Guides")}>
        {GUIDES.map((g) => (
          <button
            key={g.file}
            type="button"
            aria-current={g.file === file ? "page" : undefined}
            onClick={() => setFile(g.file)}
            className={`panel flex flex-col gap-1 px-3 py-2 text-left cursor-pointer ${g.file === file ? "border-gold bg-bg-2" : "hover:border-gold"}`}
          >
            <span className="flex items-center gap-2">
              <span className={`font-medium ${g.file === file ? "text-gold-bright" : ""}`}>{t(g.label)}</span>
              {yours.has(g.file) && g.file !== "members.md" && <span className="ml-auto text-xs uppercase tracking-wider text-net-party">{t("Your role")}</span>}
            </span>
            <span className="text-xs text-text-muted">{t(g.who)}</span>
          </button>
        ))}
        <p className="px-1 text-xs text-text-muted">{t("These match the version of the app you have installed.")}</p>
      </nav>
      {/* eslint-disable-next-line react/no-danger */}
      <div ref={page} className="panel prose min-w-0 flex-1 overflow-y-auto p-6" onClick={follow} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
