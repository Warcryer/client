// The app in the player's language: the part with no imports, so that it can
// be tested on its own (server decision 66, the interface stages).
//
// Sentences stay in the code in English, and the English sentence is the key
// its translations are found under. A value inside a sentence (a name, a
// number) is marked with `d()` as it already is for the alliance's own words:
// here each marked value becomes a numbered place, `{0}`, `{1}`, so that
// "Move ⁨Kestrel⁩ to another clan" is looked up as "Move {0} to another clan"
// and a translation may put the name wherever its grammar wants it.
//
// A count has forms that differ by language (English two, Polish and Russian
// three or four): such a sentence is kept as one entry with a form per
// category of `Intl.PluralRules`, and `{n}` is the place of the number.

/** The marks `d()` puts around a value (src/reword.ts). */
const OPEN = "\u2068";
const CLOSE = "\u2069";

export type Forms = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
/** A language's sentences, by their English. A sentence with a count has forms. */
export type Catalogue = Record<string, string | Forms>;

/** A sentence with marked values, taken apart: the key it is looked up under, and the values in order. */
export function keyOf(text: string): { key: string; values: string[] } {
  if (!text.includes(OPEN)) return { key: text, values: [] };
  const values: string[] = [];
  let key = "";
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf(OPEN, at);
    if (open < 0) {
      key += text.slice(at);
      break;
    }
    const close = text.indexOf(CLOSE, open + 1);
    key += `${text.slice(at, open)}{${values.length}}`;
    // An opening mark with no end: the rest is the value, as `reword` reads it.
    values.push(close < 0 ? text.slice(open + 1) : text.slice(open + 1, close));
    if (close < 0) break;
    at = close + 1;
  }
  return { key, values };
}

/** A translation with its numbered places filled in. A place the translation does not have is simply not said. */
export const fill = (template: string, values: readonly string[]): string => template.replace(/\{(\d+)\}/g, (all, i: string) => values[Number(i)] ?? all);

/**
 * A sentence in the language of `catalogue`, or null when it has no translation there (the caller then
 * says it in English). Values marked with `d()` come through as typed, without their marks.
 */
export function translate(catalogue: Catalogue, text: string): string | null {
  const { key, values } = keyOf(text);
  const hit = catalogue[key];
  return typeof hit === "string" && hit ? fill(hit, values) : null;
}

/**
 * A sentence with a count. `many` is its English for more than one, with `{n}` where the number goes
 * ("{n} members"), and is the key; `one` is its English for exactly one. It may carry values marked
 * with `d()` like any other sentence ("{n} players, {0} points in all"). Null when the language has
 * no entry for it.
 */
export function translateCount(catalogue: Catalogue, rules: Intl.PluralRules, n: number, many: string, shown: string): string | null {
  const { key, values } = keyOf(many);
  const hit = catalogue[key];
  const form = !hit ? null : typeof hit === "string" ? hit : (hit[rules.select(n) as keyof Forms] ?? hit.other);
  return form ? fill(form.replace(/\{n\}/g, shown), values) : null;
}

/** English's own two forms. */
export const englishCount = (n: number, one: string, many: string, shown: string): string => (n === 1 ? one : many).replace(/\{n\}/g, shown);

/**
 * A sentence with named places for things that are not text (a name in bold, a button): the sentence
 * cut at its places, in the order the language has them. "{name} asks to join {party}" gives
 * ["", {place: "name"}, " asks to join ", {place: "party"}, ""].
 */
export function pieces(template: string): (string | { place: string })[] {
  const out: (string | { place: string })[] = [];
  let at = 0;
  for (const m of template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) {
    out.push(template.slice(at, m.index));
    out.push({ place: m[1] });
    at = (m.index ?? 0) + m[0].length;
  }
  out.push(template.slice(at));
  return out;
}

/** The places a sentence has: numbered, named and `{n}`. A translation must have exactly the same. */
export const placesOf = (template: string): string[] => [...template.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map((m) => m[1]).sort();

/** The plural categories a language uses, as `Intl.PluralRules` names them: what a counted sentence needs a form for. */
export function categoriesOf(lang: string): string[] {
  const rules = new Intl.PluralRules(lang);
  return [...new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 20, 21, 22, 25, 100, 101, 102, 111, 1000, 1.5].map((n) => rules.select(n)))].sort();
}

/**
 * What is wrong with a translation of `english`, or "" when it can be used: it must not be empty, must
 * keep every place exactly once more or less as the English has them, and, for a counted sentence, have
 * a form for every category its language uses.
 */
export function problemWith(english: string, entry: string | Forms | undefined, lang: string, counted: boolean): string {
  if (entry === undefined) return "no translation";
  const want = placesOf(english).join(",");
  const check = (text: string | undefined, what: string): string => {
    if (!text || !text.trim()) return `${what} is empty`;
    return placesOf(text).join(",") === want ? "" : `${what} has the places {${placesOf(text).join("}, {")}} where the English has {${placesOf(english).join("}, {")}}`;
  };
  if (!counted) return typeof entry === "string" ? check(entry, "the translation") : "has forms, but the sentence has no count";
  if (typeof entry === "string") return "a counted sentence needs a form for each category";
  for (const category of categoriesOf(lang)) {
    const problem = check(entry[category as keyof Forms], `the form "${category}"`);
    if (problem) return problem;
  }
  return "";
}
