// The app in other languages (server decision 66): what is checked at build time.
//
//   node scripts/i18n.mjs            in the stage's files, every visible sentence goes through t(), tn() or
//                                    tx(); every such sentence has a usable translation in every catalogue
//                                    (src/locales/<code>.json). Fails otherwise.
//   node scripts/i18n.mjs --fix      wraps what can be wrapped where it stands (as words.mjs does for the
//                                    alliance's words); what is left is reported, to do by hand.
//   node scripts/i18n.mjs --keys f   writes every sentence of the stage's files to a file, with where it
//                                    stands and whether it is counted: what the translation run works from.
//   node scripts/i18n.mjs --loose    reports unwrapped text and missing translations without failing
//                                    (while a stage is being worked on).
//
// A sentence is found where it is written: the first argument of t() and tx(), the last two of tn(), the
// argument of m(), and the texts of a top-level list marked "t() where shown" (a list joined with "\n" is one
// sentence, as it is shown). A value inside a sentence must be marked with d(), or the sentence cannot be
// looked up; a choice between two texts of ours inside a sentence is read as both sentences.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { problemWith } from "../src/i18n-core.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const LOCALES = path.join(SRC, "locales");
const FIX = process.argv.includes("--fix");
const LOOSE = process.argv.includes("--loose");
const KEYS_OUT = process.argv.includes("--keys") ? process.argv[process.argv.indexOf("--keys") + 1] : null;
const STAGE = new Set(JSON.parse(readFileSync(path.join(ROOT, "scripts/i18n-stage.json"), "utf8")).files);

const ENTITIES = { apos: "'", amp: "&", quot: '"', lt: "<", gt: ">", nbsp: "\u00a0", rarr: "→", larr: "←", hellip: "…", middot: "·", times: "×", mdash: "—", ndash: "–" };
const decode = (text, where) =>
  text.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (all, name) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    if (!(name in ENTITIES)) throw new Error(`${where}: unknown entity ${all}; add it to scripts/i18n.mjs`);
    return ENTITIES[name];
  });
/** JSX text the way React reads it: lines trimmed and joined by one space. */
const cook = (text) =>
  text
    .split(/\r\n|\n|\r/)
    .map((line, i, all) => {
      let s = line.replace(/\t/g, " ");
      if (i !== 0) s = s.replace(/^ +/, "");
      if (i !== all.length - 1) s = s.replace(/ +$/, "");
      return s;
    })
    .filter((s) => s !== "")
    .join(" ");

// Not a sentence: a name in the code ("clan.get", "party-1", "lounge"), class names, a key, a file, an address.
const identifierLike = (s) => /^[a-z][A-Za-z0-9_.:/-]*$/.test(s) || /^[A-Z][A-Z0-9_]+$/.test(s) && s.length > 12;
const cssLike = (s) => /[-:\[]/.test(s) && s.split(/\s+/).every((w) => /^[a-z0-9!\[\]/:.%#()_,&>*+~=-]+$/.test(w));
const technical = (s) => /^[@_]/.test(s) || /^(rgba?|hsla?|var|calc|url|translate|scale|rotate)\(/.test(s) || /^(https?:|wss?:|data:|\.{0,2}\/|[\w.-]+\/[\w./-]+$|#[0-9a-f]{3,8}$|[\w-]+\.(?:json|png|svg|ogg|wav|css|js)$)/i.test(s) || /^\s*$/.test(s) || /^[^\p{L}]*$/u.test(s);
// Text only this many letters long is a mark, not a sentence: "×", "·", "?", "▼".
const sentence = (s) => /\p{L}{2,}/u.test(s) && !identifierLike(s) && !cssLike(s) && !technical(s);
// Attributes whose text nobody reads, and calls whose strings are names for the program.
const SKIP_ATTRS = new Set(["className", "class", "key", "id", "type", "name", "href", "src", "role", "htmlFor", "value", "d", "viewBox", "style", "fill", "stroke", "strokeLinecap", "strokeLinejoin", "autoComplete", "target", "rel", "method", "inputMode", "pattern", "accept", "lang", "dir", "points", "transform", "x", "y", "cx", "cy", "r", "width", "height", "in", "in2", "result", "values", "operator", "mode", "floodColor", "filter", "clipPath", "mask", "preserveAspectRatio", "xmlns"]);
// code("West"): a name for the program that happens to look like a word; nobody is shown it.
const WRAPPERS = new Set(["t", "tn", "tx", "m", "d", "reword", "own", "code"]);
const QUIET_CALLS = /^(rpc|invoke|grip|import|require|fetch|log|warn|error|debug|info|getItem|setItem|removeItem|querySelector|querySelectorAll|addEventListener|removeEventListener|getAttribute|setAttribute|hasAttribute|closest|matches|createElement|postMessage|emit|listen|startsWith|endsWith|includes|indexOf|split|join|replace|replaceAll|match|test|exec|padStart|padEnd|toLocaleString|toLocaleDateString|toLocaleTimeString|localeCompare|RegExp|URL|Error|TypeError|BroadcastChannel|Set|Map|select|send|cue|play|reportVoice|getPropertyValue|setProperty|has|get|set|delete|add|classList)$/;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) files.push(full);
  }
})(SRC);

/** Every sentence found: key -> { counted, files }. */
const found = new Map();
const note = (key, where, counted = false) => {
  const had = found.get(key) ?? { counted, where: [] };
  had.counted ||= counted;
  if (!had.where.includes(where)) had.where.push(where);
  found.set(key, had);
};

let unwrapped = 0;
let unreadable = 0;
let fixed = 0;
for (const file of files) {
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  const staged = STAGE.has(rel);
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const at = (node) => `src/${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const edits = [];
  let usesD = false;

  // ---- 1. The sentences that are written down for translation ----
  /** The texts an expression can be, when it is made only of our own text: a literal, a choice between two, a template of those and d() values. Null when it is something else. */
  const textsOf = (e) => {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return textsOf(e.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
    if (ts.isConditionalExpression(e)) {
      const a = textsOf(e.whenTrue), b = textsOf(e.whenFalse);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = textsOf(e.left), b = textsOf(e.right);
      return a && b ? a.flatMap((x) => b.map((y) => x + y)) : null;
    }
    if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      // `shown ?? "fallback"`: the fallback is ours; the other side is somebody's, and is read where it is written.
      const b = textsOf(e.right);
      return b ? [...(textsOf(e.left) ?? []), ...b] : null;
    }
    if (ts.isTemplateExpression(e)) {
      let outs = [{ text: e.head.text, n: 0 }];
      for (const span of e.templateSpans) {
        const x = span.expression;
        const isD = ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "d";
        const inner = isD ? null : textsOf(x);
        if (!isD && !inner) return null;
        outs = isD ? outs.map((o) => ({ text: `${o.text}{${o.n}}${span.literal.text}`, n: o.n + 1 })) : outs.flatMap((o) => inner.map((t) => ({ text: o.text + t + span.literal.text, n: o.n })));
      }
      return outs.map((o) => o.text);
    }
    // The texts of a list joined with a line break are one sentence, as they are shown.
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "join" && ts.isArrayLiteralExpression(e.expression.expression)) {
      const sep = e.arguments[0] && ts.isStringLiteral(e.arguments[0]) ? e.arguments[0].text : ",";
      const parts = e.expression.expression.elements.map(textsOf);
      return parts.every((p) => p && p.length === 1) ? [parts.map((p) => p[0]).join(sep)] : null;
    }
    return null;
  };
  const collect = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      if ((fn === "t" || fn === "tx" || fn === "m") && node.arguments[0]) {
        const texts = textsOf(node.arguments[0]);
        if (texts) for (const key of texts) note(key, `src/${rel}`);
        // A sentence handed on by name (t(label), t(HELP)) is written down elsewhere, in a list marked "t() where shown" or with m().
        else if (staged && (ts.isTemplateExpression(node.arguments[0]) || ts.isBinaryExpression(node.arguments[0]))) {
          unreadable++;
          console.log(`${at(node)}  a value in this sentence is not marked with d(), so it cannot be looked up: ${node.arguments[0].getText(sf).slice(0, 100)}`);
        }
      }
      if (fn === "tn" && node.arguments.length === 3) {
        const one = textsOf(node.arguments[1]), many = textsOf(node.arguments[2]);
        if (one?.length === 1 && many?.length === 1 && many[0].includes("{n}")) note(many[0], `src/${rel}`, true);
        else if (staged) {
          unreadable++;
          console.log(`${at(node)}  tn() takes the count and two texts with {n} in them: ${node.getText(sf).slice(0, 100)}`);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  // Lists written outside any function and shown through t() elsewhere.
  for (const stmt of sf.statements) {
    if (!/t\(\) where shown/.test(source.slice(stmt.getFullStart(), stmt.getStart(sf)))) continue;
    const gather = (node) => {
      const texts = ts.isCallExpression(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) ? textsOf(node) : null;
      if (texts && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
        for (const key of texts) if (sentence(key)) note(key, `src/${rel}`);
        return;
      }
      ts.forEachChild(node, gather);
    };
    gather(stmt);
  }

  // ---- 2. In the stage's files: visible text that is not wrapped ----
  if (staged) {
    const insideFunction = (node) => {
      for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return true;
      return false;
    };
    const saidWhereShown = (node) => {
      let top = node;
      while (top.parent && !ts.isSourceFile(top.parent)) top = top.parent;
      return /t\(\) where shown|not shown/.test(source.slice(top.getFullStart(), top.getStart(sf)));
    };
    const wrapped = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && WRAPPERS.has(p.expression.text)) return true;
        if (ts.isFunctionLike(p)) return false;
      }
      return false;
    };
    const skipped = (node) => {
      const p = node.parent;
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p) || ts.isTypeOfExpression?.(p)) return true;
      if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) && p.name === node) return true;
      if (ts.isElementAccessExpression(p)) return true;
      if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
      for (let a = node.parent; a; a = a.parent) {
        if (ts.isJsxAttribute(a)) return SKIP_ATTRS.has(a.name.getText(sf)) || a.name.getText(sf).startsWith("data-");
        if (ts.isTypeNode(a)) return true;
        if (ts.isCallExpression(a) && a.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
        if (ts.isCallExpression(a) || ts.isNewExpression(a)) {
          const callee = a.expression;
          const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
          if (QUIET_CALLS.test(name)) return true;
        }
        if (ts.isFunctionLike(a) || ts.isJsxElement(a)) break;
      }
      return false;
    };
    const report = (node, why, text) => {
      unwrapped++;
      console.log(`${at(node)}  ${why}: ${JSON.stringify(text.slice(0, 100))}`);
    };
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const raw = node.getFullText(sf);
        const inner = raw.trim();
        // Text between tags is always read by someone: one lower-case word ("connected", "muted") is a sentence
        // here, where in a string it would be a name in the code.
        if (inner && /\p{L}{2,}/u.test(decode(cook(inner), at(node))) && !technical(decode(cook(inner), at(node)))) {
          // Text between elements of one sentence ("<b>Ada</b> asks to join <b>Vanguard</b>") cannot be wrapped
          // piece by piece: a translation orders the pieces its own way. That is tx(), written by hand.
          // A label beside its control (text, then an input or a help icon) is a sentence of its own and is wrapped
          // as it stands. What cannot be: text with other words around it in the same line, in elements that
          // only dress text (a name in bold) or as values.
          const tagOf = (c) => (ts.isJsxElement(c) ? c.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(c) ? c.tagName.getText(sf) : "");
          const DRESS = new Set(["span", "b", "strong", "em", "i", "kbd", "code", "a", "u", "small"]);
          const others = node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) ? node.parent.children.filter((c) => c !== node) : [];
          const sibling =
            others.some((c) => ts.isJsxText(c) && /\p{L}{2,}/u.test(c.getText(sf))) ||
            others.some((c) => DRESS.has(tagOf(c))) ||
            others.some((c) => ts.isJsxExpression(c) && c.expression && !ts.isJsxElement(c.expression) && !ts.isBinaryExpression(c.expression) && !ts.isConditionalExpression(c.expression) && c.getText(sf) !== '{" "}' && !/^\{\/\*/.test(c.getText(sf)));
          if (sibling) report(node, "text beside other things in one sentence (make it one sentence with tx(), or t() if the parts are separate)", cook(inner));
          else if (!FIX) report(node, "text", cook(inner));
          else {
            const lead = raw.slice(0, raw.length - raw.trimStart().length);
            const trail = raw.slice(raw.trimEnd().length);
            edits.push([node.getFullStart(), node.getEnd(), `${lead}{t(${JSON.stringify(decode(cook(inner), at(node)))})}${trail}`]);
          }
        }
        return;
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && sentence(node.text) && !skipped(node) && !wrapped(node)) {
        if (!insideFunction(node)) {
          if (!saidWhereShown(node)) report(node, 'outside any function (wrap where it is shown and mark its list "t() where shown", or "not shown")', node.text);
        } else if (!FIX) report(node, "string", node.text);
        else if (ts.isJsxAttribute(node.parent)) edits.push([node.getStart(sf), node.getEnd(), `{t(${JSON.stringify(decode(node.text, at(node)))})}`]);
        else edits.push([node.getStart(sf), node.getEnd(), `t(${node.getText(sf)})`]);
        return;
      }
      if (ts.isTemplateExpression(node) && !skipped(node) && !wrapped(node)) {
        // A template is a sentence when one of its own pieces reads as words; `join-${id}`, a file's path and a
        // row of class names are put together the same way and are none.
        const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].map((p) => p.trim()).filter(Boolean);
        const quasis = parts.join(" ");
        const wordy = parts.some((p) => !cssLike(p) && !identifierLike(p) && !technical(p) && (/\p{L}{2,}[,.:;!?]?\s+\p{L}{2,}/u.test(p) || /^\p{Lu}\p{Ll}{2,}/u.test(p) || /\p{Ll}{3,}[.!?…]$/u.test(p)));
        if (wordy && sentence(quasis)) {
          if (!insideFunction(node)) {
            if (!saidWhereShown(node)) report(node, "outside any function", quasis);
          } else if (!FIX) report(node, "template", quasis);
          else {
            for (const span of node.templateSpans) {
              const e = span.expression;
              if (textsOf(e)) continue; // a choice between texts of ours: read as each sentence
              usesD = true;
              edits.push([e.getStart(sf), e.getStart(sf), "d("], [e.getEnd(), e.getEnd(), ")"]);
            }
            edits.push([node.getStart(sf), node.getStart(sf), "t("], [node.getEnd(), node.getEnd(), ")"]);
          }
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  if (FIX && edits.length) {
    const ordered = edits.map((e, i) => [...e, i]).sort((a, b) => b[0] - a[0] || b[3] - a[3]);
    let out = source;
    for (const [from, to, text] of ordered) out = out.slice(0, from) + text + out.slice(to);
    const here = path.relative(path.dirname(file), path.join(SRC, "words")).replace(/\\/g, "/");
    const spec = here.startsWith(".") ? here : `./${here}`;
    const had = /import \{([^}]*)\} from "(\.\.?\/)+words";/.exec(out);
    if (!had) {
      const firstImport = out.search(/^import /m);
      out = out.slice(0, Math.max(0, firstImport)) + `import { ${usesD ? "d, t" : "t"} } from "${spec}";\n` + out.slice(Math.max(0, firstImport));
    } else {
      const names = new Set(had[1].split(",").map((s) => s.trim()).filter(Boolean));
      names.add("t");
      if (usesD) names.add("d");
      out = out.replace(had[0], `import { ${[...names].sort().join(", ")} } from "${had[0].match(/from "([^"]+)"/)[1]}";`);
    }
    writeFileSync(file, out);
    fixed += edits.length;
  }
}

// ---- 3. The catalogues ----
const stagedKeys = [...found].filter(([, v]) => v.where.some((w) => STAGE.has(w.replace(/^src\//, ""))));
if (KEYS_OUT) {
  writeFileSync(KEYS_OUT, JSON.stringify(stagedKeys.map(([key, v]) => ({ key, counted: v.counted, where: v.where })), null, 1));
  console.log(`${stagedKeys.length} sentences of the stage's files written to ${KEYS_OUT} (${stagedKeys.reduce((n, [k]) => n + k.split(/\s+/).length, 0)} words)`);
}
let missing = 0;
const langs = existsSync(LOCALES) ? readdirSync(LOCALES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [];
for (const lang of langs) {
  const catalogue = JSON.parse(readFileSync(path.join(LOCALES, `${lang}.json`), "utf8"));
  let bad = 0;
  for (const [key, v] of stagedKeys) {
    const problem = problemWith(key, catalogue[key], lang, v.counted);
    if (problem && bad++ < 8) console.log(`src/locales/${lang}.json  ${JSON.stringify(key.slice(0, 70))}: ${problem}`);
  }
  if (bad > 8) console.log(`src/locales/${lang}.json  ... and ${bad - 8} more`);
  const extra = Object.keys(catalogue).filter((k) => !found.has(k)).length;
  if (extra) console.log(`src/locales/${lang}.json  has ${extra} sentences the app no longer says (harmless; the translation run drops them)`);
  missing += bad;
}

if (FIX) console.log(`wrapped ${fixed} places; ${unwrapped} left to do by hand`);
const total = unwrapped + unreadable + missing;
console.log(
  total === 0
    ? `the stage's ${stagedKeys.length} sentences are all wrapped${langs.length ? ` and translated into ${langs.length} languages` : "; no catalogue yet"}`
    : `${unwrapped} visible texts are not wrapped, ${unreadable} sentences cannot be read, ${missing} translations are missing or unusable`,
);
process.exit(total && !LOOSE && !FIX ? 1 : 0);
