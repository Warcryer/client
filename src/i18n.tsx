// The app in the player's language (server decision 66, the interface stages).
//
// Sentences are written in English in the code and looked up, by that
// English, in the catalogue of the language the player chose in Settings
// (src/locales/<code>.json, made at build time and checked by
// scripts/i18n.mjs; only the chosen one is loaded). A sentence with no
// translation is said in English: never a hole, never a key.
//
//   t("Create clan")                          a sentence (src/words.ts)
//   t(`Move ${d(name)} to another clan`)      with a value: marked with d(), as for the alliance's words
//   tn(n, "{n} member", "{n} members")        with a count: each language has its own forms
//   tx("{name} asks to join {party}", {...})  with things that are not text: a name in bold, a button
//   m("Voice")                                a sentence written down here and shown elsewhere, through t()
//
// In English a sentence is also said in the alliance's own words (a clan may
// be a guild). In other languages the app uses that language's usual words for
// the five: an alliance's English words cannot be bent to another grammar
// (owner, 2026-11-21).

import { useSyncExternalStore, type ReactNode } from "react";
import { englishCount, pieces, translate, translateCount, type Catalogue } from "./i18n-core";

type State = { lang: string; catalogue: Catalogue | null; rules: Intl.PluralRules; numbers: Intl.NumberFormat };
const english = (): State => ({ lang: "en", catalogue: null, rules: new Intl.PluralRules("en"), numbers: new Intl.NumberFormat("en") });
let state: State = english();
const listeners = new Set<() => void>();
const files = import.meta.glob<{ default: Catalogue }>("./locales/*.json");
const REMEMBERED = "language.v1";

/** The languages the app itself can be shown in: English, and every language that has a catalogue. */
export const interfaceLanguages = (): string[] => ["en", ...Object.keys(files).map((f) => f.replace(/^.*\/|\.json$/g, ""))];

/** The language the app is shown in right now. */
export const language = (): string => state.lang;
/** The catalogue of the language in use; null in English. For src/words.ts. */
export const catalogue = (): Catalogue | null => state.catalogue;

let wanted = "en";
/**
 * Shows the app in a language: the player's choice in Settings, or null for English. A language the app
 * has no catalogue for is English too. Remembered on this computer, so that the screens before sign-in
 * come up in it next time.
 */
export async function setLanguage(code: string | null): Promise<void> {
  const lang = code && files[`./locales/${code}.json`] ? code : "en";
  wanted = lang;
  try {
    if (code) localStorage.setItem(REMEMBERED, code);
    else localStorage.removeItem(REMEMBERED);
  } catch {
    /* a browser that keeps nothing: the choice still holds while the app is open */
  }
  if (lang === state.lang) return;
  let next = english();
  if (lang !== "en") {
    const loaded = await files[`./locales/${lang}.json`]().catch(() => null);
    // The player chose again while this one was loading, or it would not load: nothing to show.
    if (wanted !== lang || !loaded) return;
    next = { lang, catalogue: loaded.default, rules: new Intl.PluralRules(lang), numbers: new Intl.NumberFormat(lang) };
  }
  state = next;
  document.documentElement.lang = lang;
  for (const l of listeners) l();
}

/** The language chosen on this computer last time, for the screens before the server has said who the player is. */
export function rememberedLanguage(): string | null {
  try {
    return localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

/** Draws the caller again when the language changes. Read once near the top of the app. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.lang,
  );
}

/**
 * How a sentence is said in English: in the alliance's own words. src/words.ts, which knows them, hands
 * this over when it loads (it cannot be imported from here: it imports this file).
 */
let inEnglish = (text: string): string => text;
export const englishIs = (say: (text: string) => string): void => {
  inEnglish = say;
};

/** A sentence with a count: "1 member", "3 members", and the forms the player's language has. `{n}` is where the number goes. */
export function tn(n: number, one: string, many: string): string {
  const shown = state.numbers.format(n);
  return (state.catalogue && translateCount(state.catalogue, state.rules, n, many, shown)) ?? inEnglish(englishCount(n, one, many, "{n}")).replace(/\{n\}/g, shown);
}

/**
 * A sentence with things in it that are not text. The places are named in braces, and `parts` gives what
 * stands in each: `tx("{name} asks to join {party}", { name: <b>Ada</b>, party: <span>Vanguard</span> })`.
 * A translation moves the places to where its grammar wants them.
 */
export function tx(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  const other = state.catalogue && translate(state.catalogue, text);
  // In English each stretch of text between the places is said in the alliance's words; a place's name is never read as a word.
  return pieces(other ?? text).map((piece, i) => (typeof piece === "string" ? (other ? piece : inEnglish(piece)) : <span key={i} style={{ display: "contents" }}>{parts[piece.place]}</span>));
}

/** Marks a sentence that is written down in one place and shown in another through `t()`: it changes nothing, and tells scripts/i18n.mjs to collect it. */
export const m = (text: string): string => text;

/** Marks a name for the program that happens to look like a word ("West", a direction a window is dragged in): nobody is shown it, and scripts/i18n.mjs leaves it alone. */
export const code = <T extends string>(name: T): T => name;

/** A date or a time the way the player's language writes it. */
export const when = (date: Date | string | number, options: Intl.DateTimeFormatOptions): string => new Date(date).toLocaleString(state.lang === "en" ? undefined : state.lang, options);
/** A number the way the player's language writes it. */
export const count = (n: number): string => state.numbers.format(n);
