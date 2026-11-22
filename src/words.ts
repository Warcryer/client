// Saying the app's sentences in the alliance's own words.
//
// Every sentence in the app is written with the same five words: alliance,
// clan, party, constant party, operation. An alliance that calls a clan a
// guild sets that in its game setup, and `t()` says the sentence its way.
// Text a player typed is passed through `d()` first, so it is never changed:
//
//   t("Create clan")                      "Create guild"
//   t(`Move ${d(name)} to another clan`)   the name stays as typed
//
// `npm run check:words` fails if a sentence that names one of the five is not
// passed through `t()`; `node scripts/words.mjs --fix` wraps what it finds.

import { catalogue, englishIs } from "./i18n";
import { translate } from "./i18n-core";
import { d, DEFAULT_WORDS, reword, type Words } from "./reword";

let current: Words = DEFAULT_WORDS;

// Counted sentences and sentences with things in them (tn, tx in src/i18n.tsx) are said in the alliance's words too.
englishIs((text) => reword(current, text));

/** Called by the game-setup store when the alliance's words arrive or change. */
export const setWords = (words: Words | null | undefined): void => {
  current = words ?? DEFAULT_WORDS;
};

/**
 * A sentence written in English and in the app's words, said in the player's language (src/i18n.tsx), or,
 * in English, in the alliance's own words. A sentence its language has no translation for is said in English.
 */
export const t = (text: string): string => {
  const other = catalogue();
  return (other && translate(other, text)) ?? reword(current, text);
};

/**
 * Marks a word that is meant in the app's own sense and must stay as written: where an admin
 * chooses what a "clan" is called, the row has to say "clan" whatever they have chosen.
 */
export const own = (text: string): string => text;

export { d };
export type { Words };
