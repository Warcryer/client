// Finds sentences that name one of the app's five words (alliance, clan,
// party, constant party, operation) and are not passed through t(), which
// says them in the alliance's own words (src/words.ts).
//
//   node scripts/words.mjs          report what is not wrapped; fails if anything is
//   node scripts/words.mjs --fix    wrap what can be wrapped where it stands
//
// What it leaves alone: names of things in the code ("clan.get", "party"),
// class names, comparisons, and anything already inside t() or d(). A
// sentence outside any function is reported, never fixed: t() there would run
// once, before the alliance's words are known.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const FIX = process.argv.includes("--fix");
// The rules themselves and the type declarations speak about the words; they are not sentences shown to anyone.
const SKIP = new Set(["reword.ts", "words.ts", "api.ts", "vite-env.d.ts", "i18n-core.ts"]);
const TERM = /\b(constant part(?:y|ies)|alliances?|clans?|part(?:y|ies)|operations?)\b/i;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) && !SKIP.has(name)) files.push(full); // tests speak about sentences; they show none
  }
})(SRC);

const ENTITIES = { apos: "'", amp: "&", quot: '"', lt: "<", gt: ">", nbsp: " ", rarr: "→", larr: "←", hellip: "…", middot: "·", times: "×", mdash: "—", ndash: "–" };
const decode = (text, where) =>
  text.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (all, name) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    if (!(name in ENTITIES)) throw new Error(`${where}: unknown entity ${all}; add it to scripts/words.mjs`);
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

// A name in the code, not a sentence: "clan", "clan.get", "party-1".
const identifierLike = (s) => /^[a-z][A-Za-z0-9_.:/-]*$/.test(s);
// Class names: every word is lower case with a hyphen, colon or bracket somewhere.
const cssLike = (s) => /[-:\[]/.test(s) && s.split(/\s+/).every((w) => /^[a-z0-9!\[\]/:.%#()_-]+$/.test(w));
const SKIP_ATTRS = new Set(["className", "class", "key", "id", "type", "name", "href", "src", "role", "htmlFor", "value", "d", "viewBox", "style"]);
// tn() and tx() (src/i18n.tsx) say their sentence in the alliance's words as t() does; m() marks one that t() shows elsewhere.
const WRAPPERS = new Set(["t", "tn", "tx", "m", "d", "reword", "own"]);

let problems = 0;
let fixed = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(ROOT, file);
  const edits = [];
  let usesD = false;
  const at = (node) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const report = (node, why, text) => {
    problems++;
    console.log(`${at(node)}  ${why}: ${JSON.stringify(text.slice(0, 90))}`);
  };

  const insideFunction = (node) => {
    for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return true;
    return false;
  };
  // A list of sentences kept outside any function is fine when the comment above it says that
  // they go through t() where they are shown: "t() where shown".
  const saidWhereShown = (node) => {
    let top = node;
    while (top.parent && !ts.isSourceFile(top.parent)) top = top.parent;
    return /t\(\) where shown/.test(source.slice(top.getFullStart(), top.getStart(sf)));
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
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p)) return true;
    if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) && p.name === node) return true;
    if (ts.isElementAccessExpression(p)) return true;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true;
    for (let a = node.parent; a; a = a.parent) {
      if (ts.isJsxAttribute(a)) return SKIP_ATTRS.has(a.name.getText(sf)) || a.name.getText(sf).startsWith("data-");
      if (ts.isTypeNode(a)) return true;
      if (ts.isFunctionLike(a) || ts.isJsxElement(a)) break;
    }
    return false;
  };
  const sentence = (text) => TERM.test(text) && !identifierLike(text) && !cssLike(text);

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getFullText(sf);
      const inner = raw.trim();
      if (inner && TERM.test(inner)) {
        if (!FIX) report(node, "text", cook(inner));
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
        if (!saidWhereShown(node)) report(node, "outside any function (wrap by hand, at the place it is shown)", node.text);
      } else if (!FIX) report(node, "string", node.text);
      else if (ts.isJsxAttribute(node.parent)) edits.push([node.getStart(sf), node.getEnd(), `{t(${JSON.stringify(decode(node.text, at(node)))})}`]);
      else edits.push([node.getStart(sf), node.getEnd(), `t(${node.getText(sf)})`]);
      return;
    }
    if (ts.isTemplateExpression(node) && !skipped(node) && !wrapped(node)) {
      const quasis = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
      if (sentence(quasis)) {
        if (!insideFunction(node)) {
          if (!saidWhereShown(node)) report(node, "outside any function (wrap by hand, at the place it is shown)", quasis);
        } else if (!FIX) report(node, "template", quasis);
        else {
          // What is put into the sentence is somebody's own text unless it is plainly one of ours.
          for (const span of node.templateSpans) {
            const e = span.expression;
            const ours = (x) => ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || (ts.isConditionalExpression(x) && ours(x.whenTrue) && ours(x.whenFalse)) || (ts.isParenthesizedExpression(x) && ours(x.expression));
            if (ours(e)) continue;
            usesD = true;
            edits.push([e.getStart(sf), e.getStart(sf), "d("], [e.getEnd(), e.getEnd(), ")"]);
          }
          edits.push([node.getStart(sf), node.getStart(sf), "t("], [node.getEnd(), node.getEnd(), ")"]);
        }
        // The pieces put into it were handled above; do not look inside them again.
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (FIX && edits.length) {
    // Applied from the end, so that earlier positions stay right. Inserts at one position keep their order.
    const ordered = edits.map((e, i) => [...e, i]).sort((a, b) => b[0] - a[0] || b[3] - a[3]);
    let out = source;
    for (const [from, to, text] of ordered) out = out.slice(0, from) + text + out.slice(to);
    const names = usesD ? "d, t" : "t";
    const here = path.relative(path.dirname(file), path.join(SRC, "words")).replace(/\\/g, "/");
    const spec = here.startsWith(".") ? here : `./${here}`;
    if (!/from "(\.\.?\/)+words"/.test(out)) {
      const firstImport = out.search(/^import /m);
      out = out.slice(0, firstImport < 0 ? 0 : firstImport) + `import { ${names} } from "${spec}";\n` + out.slice(firstImport < 0 ? 0 : firstImport);
    }
    writeFileSync(file, out);
    fixed += edits.length;
  }
}
if (FIX) console.log(`wrapped ${fixed} places; ${problems} left to do by hand`);
else console.log(problems ? `${problems} sentences are not said in the alliance's words. Wrap them in t() (node scripts/words.mjs --fix).` : "every sentence that names one of the five words goes through t()");
process.exit(problems ? 1 : 0);
