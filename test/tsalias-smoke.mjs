// Smoke test for tsconfig path-alias resolution (tsconfig.ts + resolver/graph).
// Run after `npm run build`:  node test/tsalias-smoke.mjs
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { resolveAliasedImport, resolveFileImports } from "../dist/resolver.js";
import { clearAliasCaches } from "../dist/tsconfig.js";
import { buildSkeleton } from "../dist/skeleton.js";
import { buildSymbolGraph } from "../dist/graph.js";
import { resolveOptions } from "../dist/config.js";

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

// ─── Fixture project ──────────────────────────────────────────────────────────
// root/
//   tsconfig.base.json        (baseUrl ".", paths "~lib": ["lib/index.ts"])
//   tsconfig.json             (extends base; paths "@/*": ["./src/*"], "#u/*": ["./src/utils/*"])
//   lib/index.ts
//   src/components/Button.tsx
//   src/utils/fmt.ts
//   src/app/page.tsx          (imports @/components/Button, #u/fmt, ~lib, plain-external)
//   packages/sub/jsconfig.json ("@/*" → ./web/*)  + nested override test
//   packages/sub/web/thing.js
//   packages/sub/main.js      (imports @/thing → resolves via NEAREST config)
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsalias-"));
const w = (rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};

w("tsconfig.base.json", JSON.stringify({
  compilerOptions: { baseUrl: ".", paths: { "~lib": ["lib/index.ts"] } },
}));
w("tsconfig.json", `{
  // JSONC: comments + trailing comma must parse
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "#u/*": ["./src/utils/*"],
    },
  },
}`);
w("lib/index.ts", "export const LIB = 1;\n");
w("src/components/Button.tsx", "export function Button() { return null; }\n");
w("src/utils/fmt.ts", "export function fmt(s: string) { return s; }\n");
const page = w("src/app/page.tsx", [
  'import { Button } from "@/components/Button";',
  'import { fmt } from "#u/fmt";',
  'import React from "react";',
  "export default function Page() { return Button() ?? fmt(\"x\"); }",
  "",
].join("\n"));

// extends-only config: inherits the parent's paths (child defines none)
w("extonly/tsconfig.json", JSON.stringify({ extends: "../tsconfig.base.json" }));
const extFile = w("extonly/use.ts", 'import { LIB } from "~lib";\nexport const v = LIB;\n');

w("packages/sub/jsconfig.json", JSON.stringify({
  compilerOptions: { paths: { "@/*": ["./web/*"] } },
}));
w("packages/sub/web/thing.js", "export const thing = 1;\n");
const sub = w("packages/sub/main.js", 'import { thing } from "@/thing";\nexport const m = thing;\n');

clearAliasCaches();

console.log("resolveAliasedImport:");
check("@/* → src/*", resolveAliasedImport("@/components/Button", page) === path.join(root, "src", "components", "Button.tsx"));
check("#u/* → src/utils/*", resolveAliasedImport("#u/fmt", page) === path.join(root, "src", "utils", "fmt.ts"));
// TS semantics: child `paths` REPLACES the parent's — ~lib (parent-only) is not visible here
check("child paths replace parent's (~lib hidden)", resolveAliasedImport("~lib", page) === null);
check("extends-only config inherits parent paths (~lib)", resolveAliasedImport("~lib", extFile) === path.join(root, "lib", "index.ts"));
check("non-alias bare returns null", resolveAliasedImport("react", page) === null);
check("relative returns null", resolveAliasedImport("./x", page) === null);
check("nearest config wins (jsconfig in subpackage)", resolveAliasedImport("@/thing", sub) === path.join(root, "packages", "sub", "web", "thing.js"));

// Regression: Next.js-style config — "@/*" + an `include` glob containing `*/`
// (naive comment-stripping pairs them up and corrupts the JSON)
w("nextlike/tsconfig.json", JSON.stringify({
  compilerOptions: { paths: { "@/*": ["./src/*"] } },
  include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
}, null, 2));
w("nextlike/src/components/Locale.tsx", "export const L = 1;\n");
const nextFile = w("nextlike/src/app/page.tsx", 'import { L } from "@/components/Locale";\nexport const p = L;\n');
check("Next.js-style config with **/* glob parses", resolveAliasedImport("@/components/Locale", nextFile) === path.join(root, "nextlike", "src", "components", "Locale.tsx"));

console.log("resolve_imports enrichment:");
const opts = resolveOptions({ detail: "full", emitHtml: false });
const skel = await buildSkeleton(page, "src/app/page.tsx", opts);
const resolved = await resolveFileImports(skel, page, root);
const byFrom = Object.fromEntries(resolved.map((i) => [i.from, i]));
check("@/ import marked relative + found", byFrom["@/components/Button"]?.importKind === "relative" && byFrom["@/components/Button"]?.found === true);
check("@/ resolvedRel correct", byFrom["@/components/Button"]?.resolvedRel === "src/components/Button.tsx");
check("react stays external", byFrom["react"]?.importKind === "external");

const extSkel = await buildSkeleton(extFile, "extonly/use.ts", opts);
const extResolved = await resolveFileImports(extSkel, extFile, root);
check("~lib resolves via extends-only config", extResolved.find((i) => i.from === "~lib")?.resolvedRel === "lib/index.ts");

console.log("graph edges:");
const files = [
  ["src/app/page.tsx", page],
  ["src/components/Button.tsx", path.join(root, "src/components/Button.tsx")],
  ["src/utils/fmt.ts", path.join(root, "src/utils/fmt.ts")],
  ["lib/index.ts", path.join(root, "lib/index.ts")],
];
const skels = [];
for (const [rel, abs] of files) skels.push(await buildSkeleton(abs, rel, opts));
const graph = buildSymbolGraph(skels, root);
const importEdges = graph.edges.filter((e) => e.edgeType === "imports");
check("page → Button edge", importEdges.some((e) => e.from === "src/app/page.tsx" && e.to.startsWith("src/components/Button.tsx")));
check("page → fmt edge", importEdges.some((e) => e.from === "src/app/page.tsx" && e.to.startsWith("src/utils/fmt.ts")));
check("2 alias edges total from page", importEdges.filter((e) => e.from === "src/app/page.tsx").length === 2);

fs.rmSync(root, { recursive: true, force: true });

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll ts-alias checks passed.");
