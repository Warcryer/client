import assert from "node:assert/strict";
import { test } from "node:test";
import { categoriesOf, englishCount, fill, keyOf, pieces, placesOf, problemWith, translate, translateCount, type Catalogue } from "./i18n-core.ts";

// As d() marks a value (src/reword.ts).
const d = (v: unknown) => `\u2068${String(v)}\u2069`;

test("a sentence's key has a numbered place for each marked value", () => {
  assert.deepEqual(keyOf("Create clan"), { key: "Create clan", values: [] });
  assert.deepEqual(keyOf(`Move ${d("Kestrel")} to another clan`), { key: "Move {0} to another clan", values: ["Kestrel"] });
  assert.deepEqual(keyOf(`${d("Ada")} asks to join ${d("Vanguard")}`), { key: "{0} asks to join {1}", values: ["Ada", "Vanguard"] });
  assert.deepEqual(keyOf(`Lead ${d("")} now`), { key: "Lead {0} now", values: [""] });
  assert.deepEqual(keyOf("Open \u2068mark with no end"), { key: "Open {0}", values: ["mark with no end"] });
});

test("a translation may put the values where its grammar wants them", () => {
  const pl: Catalogue = { "Move {0} to another clan": "Przenieś {0} do innego klanu", "{0} asks to join {1}": "Do {1} chce dołączyć {0}", "Create clan": "Utwórz klan", "Empty": "" };
  assert.equal(translate(pl, "Create clan"), "Utwórz klan");
  assert.equal(translate(pl, `Move ${d("Kestrel")} to another clan`), "Przenieś Kestrel do innego klanu");
  assert.equal(translate(pl, `${d("Ada")} asks to join ${d("Vanguard")}`), "Do Vanguard chce dołączyć Ada");
  assert.equal(translate(pl, "Not in the catalogue"), null);
  assert.equal(translate(pl, "Empty"), null, "an empty translation is no translation");
  assert.equal(fill("{0} and {1} and {2}", ["a", "b"]), "a and b and {2}");
});

test("a count takes the form its language has for that number", () => {
  const pl: Catalogue = { "{n} members": { one: "{n} członek", few: "{n} członków: kilku", many: "{n} członków", other: "{n} członka" } };
  const rules = new Intl.PluralRules("pl");
  assert.equal(translateCount(pl, rules, 1, "{n} members", "1"), "1 członek");
  assert.equal(translateCount(pl, rules, 3, "{n} members", "3"), "3 członków: kilku");
  assert.equal(translateCount(pl, rules, 5, "{n} members", "5"), "5 członków");
  assert.equal(translateCount(pl, rules, 22, "{n} members", "22"), "22 członków: kilku");
  assert.equal(translateCount(pl, rules, 1200, "{n} members", "1 200"), "1 200 członków");
  assert.equal(translateCount(pl, rules, 2, "{n} groups", "2"), null);
  // A counted sentence carries marked values like any other: the key has their places, the forms move them.
  const posted: Catalogue = { "{n} players, {0} {1} in all": { one: "{1}: {0} dla {n} gracza", few: "{1}: {0} dla {n} graczy", many: "{1}: {0} dla {n} graczy", other: "{1}: {0} dla {n} gracza" } };
  assert.equal(translateCount(posted, rules, 1, `{n} players, ${d(40)} ${d("DKP")} in all`, "1"), "DKP: 40 dla 1 gracza");
  assert.equal(translateCount(posted, rules, 12, `{n} players, ${d(40)} ${d("DKP")} in all`, "12"), "DKP: 40 dla 12 graczy");
  assert.equal(englishCount(1, "{n} member", "{n} members", "1"), "1 member");
  assert.equal(englishCount(0, "{n} member", "{n} members", "0"), "0 members");
});

test("the categories a language counts in", () => {
  assert.deepEqual(categoriesOf("en"), ["one", "other"]);
  assert.deepEqual(categoriesOf("pl"), ["few", "many", "one", "other"]);
  assert.deepEqual(categoriesOf("ru"), ["few", "many", "one", "other"]);
  assert.deepEqual(categoriesOf("lt"), ["few", "many", "one", "other"]);
  assert.deepEqual(categoriesOf("tr"), ["one", "other"]);
});

test("a sentence with things in it that are not text is cut at its places", () => {
  assert.deepEqual(pieces("{name} asks to join {party}"), ["", { place: "name" }, " asks to join ", { place: "party" }, ""]);
  assert.deepEqual(pieces("Do {party} chce dołączyć {name}."), ["Do ", { place: "party" }, " chce dołączyć ", { place: "name" }, "."]);
  assert.deepEqual(pieces("No places"), ["No places"]);
  assert.deepEqual(placesOf("{name} has {n} of {0}"), ["0", "n", "name"]);
});

test("what makes a translation unusable", () => {
  assert.equal(problemWith("Move {0} to another clan", "Przenieś {0} do innego klanu", "pl", false), "");
  assert.equal(problemWith("Move {0} to another clan", undefined, "pl", false), "no translation");
  assert.match(problemWith("Move {0} to another clan", "  ", "pl", false), /empty/);
  assert.match(problemWith("Move {0} to another clan", "Przenieś do innego klanu", "pl", false), /places/);
  assert.match(problemWith("{name} asks to join {party}", "{name} chce dołączyć do {name}", "pl", false), /places/);
  assert.equal(problemWith("{n} members", { one: "{n} członek", few: "{n} członków", many: "{n} członków", other: "{n} członka" }, "pl", true), "");
  assert.match(problemWith("{n} members", { one: "{n} członek", other: "{n} członków" }, "pl", true), /"few"/);
  assert.match(problemWith("{n} members", "członkowie", "pl", true), /form for each/);
  assert.match(problemWith("{n} members", { one: "członek", other: "{n} members" }, "en", true), /"one" has the places/);
});
