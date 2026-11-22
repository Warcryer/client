// The language a player reads, and the chat translated into it (server
// decision 66). Two places: a player's own choice, in Settings; and, for an
// alliance's admins, its switch, its own words for the translator and what it
// has used of the month's limit, on the Alliance tab.
//
// The app itself is in English for now. The language chosen here is the one
// the chat is translated into, and the one the app will be shown in once it
// has others.

import { count, tx } from "../i18n";
import { useEffect, useState } from "react";
import { rpc, type Info, type TranslateSettingsData } from "../api";
import { d, t } from "../words";
import { useAct, useApp } from "./app-context";
import { Help } from "./tips";

// t() where shown.
const LANGUAGE_HELP = [
  "Choose the language you read. The app itself is in English for now; your choice is used to translate the chat, and for the app once it is translated.",
  "With translation on, a line written in another language still appears at once, as it was written. A second or so later it changes to your language and is marked \"translated\". Click that mark to see the line as it was written.",
  "Lines in your own language, and lines with nothing to translate (names, numbers, \"gg\"), stay as they are. What you write is not changed for you: each reader's own choice decides what they see.",
  "A machine translates. It keeps game talk as players write it, and it is sometimes wrong, more often with slang and in the smaller languages. When a line matters, look at the original.",
  "To translate a line, it is sent from our server to Anthropic (the maker of Claude) when at least one reader on that net has translation on. Your alliance's admins can switch translation off for the whole alliance.",
].join("\n");

/** The language of the computer, if it is one the app has: offered, never chosen for the player. */
const guess = (languages: Record<string, string>): string | null => {
  const tags = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])];
  for (const tag of tags) {
    if (!tag) continue;
    if (Object.hasOwn(languages, tag)) return tag;
    const short = tag.split("-")[0];
    const hit = Object.keys(languages).find((code) => code === short || code.split("-")[0] === short);
    if (hit) return hit;
  }
  return null;
};

/** In Settings: the player's language and their own switch. Nothing is shown on a server that has no translation. */
export function LanguageSettings() {
  const { info, refreshInfo } = useApp();
  const act = useAct();
  const tr: Info["translation"] = info.translation;
  // A choice shows at once; the server's answer follows, and puts it back if it said no.
  const [asked, setAsked] = useState<{ lang: string | null; chatTranslate: boolean } | null>(null);
  useEffect(() => setAsked(null), [info.user.lang, info.user.chatTranslate]);
  const lang = asked ? asked.lang : (info.user.lang ?? null);
  const on = asked ? asked.chatTranslate : info.user.chatTranslate === true;
  const save = (next: { lang: string | null; chatTranslate: boolean }) => {
    setAsked(next);
    void act.run(() => rpc("profile.language", next)).then((ok) => {
      if (!ok) setAsked(null);
      refreshInfo();
    });
  };
  if (!tr) return null;
  const suggested = lang === null ? guess(tr.languages) : null;
  // Why the switch cannot be used right now, said beside it.
  const why = !tr.available ? t("Translation is not available on this server.") : info.alliance && !tr.allianceOn ? t("Your alliance's admins have switched chat translation off.") : lang === null ? t("Choose your language first.") : "";
  return (
    <div className="flex flex-col gap-3" data-language>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-text-muted">
          {t("Your language")}
          <select
            className="field w-auto"
            value={lang ?? ""}
            disabled={act.busy}
            aria-label={t("Your language")}
            onChange={(e) => save({ lang: e.target.value || null, chatTranslate: e.target.value ? on : false })}
            data-language-pick
          >
            <option value="">{t("Not chosen")}</option>
            {Object.entries(tr.languages).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        <Help text={t(LANGUAGE_HELP)} />
        {suggested && (
          <button type="button" className="btn btn-quiet px-3 py-0.5 text-sm" disabled={act.busy} onClick={() => save({ lang: suggested, chatTranslate: false })} data-language-suggest>
            {tr.languages[suggested]}?
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className={`flex items-center gap-2 ${why ? "text-text-muted" : ""}`}>
          <input type="checkbox" checked={on && !why} disabled={act.busy || !!why} onChange={(e) => save({ lang, chatTranslate: e.target.checked })} data-language-translate />
          {t("Translate the chat into my language")}
        </label>
        {why && <span className="text-xs text-text-muted" data-language-why>{why}</span>}
      </div>
      <p className="text-xs text-text-muted">{t("The app itself is in English for now. Your language is what the chat is translated into.")}</p>
      {act.error && <p className="text-danger" role="alert">{act.error}</p>}
    </div>
  );
}

// t() where shown.
export const TRANSLATE_SETTINGS_HELP = [
  "Players of different countries share your chat. Each of them can choose their language in Settings and have the chat translated into it; a line is always shown as written first, with the translation following a moment later.",
  "This switch is for the whole alliance. On: every member may use translation. Off: nobody's chat is translated, and no line of your alliance is sent to be translated.",
  "To translate a line it is sent from our server to Anthropic (the maker of Claude) when at least one reader on that net has translation on. That includes lines written by members who do not use translation themselves.",
  "Your own words: slang the translator should read correctly, and names it must leave alone, one per line. For example \"soski = soulshots\" or \"Cruma = a place, keep it\". Your game's classes, kinds of event and quick calls are already known to it.",
  "The limit is per month. Lines with nothing to translate, lines nobody needs in another language, and lines translated before do not count. Past the limit, lines stay as written until the next month.",
].join("\n");

/** On the Alliance tab: the alliance's switch, its own words for the translator, and the month's count. */
export function TranslateSettings({ settings, onChange }: { settings: TranslateSettingsData; onChange: () => void }) {
  const act = useAct();
  const [on, setOn] = useState(settings.on);
  const [words, setWords] = useState(settings.glossary);
  useEffect(() => setOn(settings.on), [settings.on]);
  useEffect(() => setWords(settings.glossary), [settings.glossary]);
  const send = (patch: { on?: boolean; glossary?: string }) => void act.run(() => rpc("alliance.setTranslate", patch)).then(onChange);
  if (!settings.available) return <p className="text-sm text-text-muted" data-translate-settings>{t("Translation is not available on this server.")}</p>;
  const over = settings.month >= settings.cap;
  return (
    <div className="flex flex-col gap-3" data-translate-settings>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          disabled={act.busy}
          onChange={(e) => {
            setOn(e.target.checked);
            send({ on: e.target.checked });
          }}
          data-translate-switch
        />
        {t("Members may have the chat translated into their language")}
        <span className="text-xs text-text-muted">{t("Off: no line of the alliance is sent to be translated.")}</span>
      </label>
      <p className={`text-sm ${over ? "text-danger" : "text-text-muted"}`} data-translate-usage>
        {tx("{used} of {limit} lines translated this month.", { used: <span className="tabular-nums">{count(settings.month)}</span>, limit: <span className="tabular-nums">{count(settings.cap)}</span> })}
        {over && <> {t("The limit is reached: lines stay as written until next month.")}</>}
      </p>
      <label className="flex flex-col gap-1 text-text-muted">
        {t("Your alliance's own words, one per line")}
        <textarea
          className="field min-h-24 font-mono text-sm"
          value={words}
          maxLength={5000}
          spellCheck={false}
          placeholder={t("soski = soulshots\nCruma = a place, keep it")}
          onChange={(e) => setWords(e.target.value)}
          data-translate-words
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className="btn text-sm" disabled={act.busy || words === settings.glossary} onClick={() => send({ glossary: words })} data-translate-save>
          {t("Save the words")}
        </button>
        {act.error && <span className="text-danger" role="alert">{act.error}</span>}
      </div>
    </div>
  );
}
