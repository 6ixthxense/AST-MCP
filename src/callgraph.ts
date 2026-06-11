import fs from "node:fs";
import path from "node:path";
import { parseSource } from "./parser.js";
import type { TSNode } from "./parser.js";
import { buildSkeleton } from "./skeleton.js";
import { resolveOptions, loadProjectConfig } from "./config.js";
import { detectLanguage } from "./registry.js";
import { resolveImportPath, resolveAliasedImport, getOrBuildCrossLangIndex } from "./resolver.js";
import { resolveCrossLangTarget } from "./crosslang.js";
import type { ImportRef, SkeletonFile } from "./types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CallRef {
  callee: string;
  line: number;
  calleeFileRel?: string;
  isLocal?: boolean;
  isExternal?: boolean;
}

export interface CalledByRef {
  file: string;
}

export interface CallGraphResult {
  file: string;
  function: string;
  functionRange: { startLine: number; endLine: number };
  /** Decorators applied to the function (e.g. `router.get("/x")`), if any. */
  decorators?: string[];
  calls: CallRef[];
  calledBy: CalledByRef[];
}

const CROSS_LANG = new Set(["java", "csharp", "rust", "go", "kotlin", "c", "cpp", "swift"]);

// ─── Call extraction ──────────────────────────────────────────────────────────

interface RawCall {
  callee: string;
  line: number;
}

function pushCall(out: RawCall[], callee: string | null, anchor: TSNode | null): void {
  if (callee && anchor) out.push({ callee, line: anchor.startPosition.row + 1 });
}

function collectCalls(node: TSNode, out: RawCall[]): void {
  const t = node.type;

  // ── call_expression: TS/JS (member_expression) | Python "call" (attribute) |
  //    Go (selector_expression) | Rust (field_expression, scoped_identifier)
  if (t === "call_expression" || t === "call") {
    const fn = node.childForFieldName("function");
    if (fn) {
      let callee: string | null = null;
      switch (fn.type) {
        case "identifier":
          callee = fn.text;
          break;
        case "member_expression":
        case "attribute": {
          const obj = fn.childForFieldName("object");
          const prop = fn.childForFieldName("property") ?? fn.childForFieldName("attribute");
          if (prop) callee = obj ? `${obj.text}.${prop.text}` : prop.text;
          break;
        }
        case "field_expression": {
          // Rust: inv.reserve — fields are `value` and `field`
          const obj = fn.childForFieldName("value");
          const fld = fn.childForFieldName("field");
          if (fld) callee = obj ? `${obj.text}.${fld.text}` : fld.text;
          break;
        }
        case "scoped_identifier":
          // Rust: String::from / helpers::format — keep full path
          callee = fn.text;
          break;
        case "selector_expression": {
          // Go: pkg.Func
          const obj = fn.childForFieldName("operand");
          const fld = fn.childForFieldName("field");
          if (fld) callee = obj ? `${obj.text}.${fld.text}` : fld.text;
          break;
        }
      }
      pushCall(out, callee, fn);
    } else {
      // Kotlin: call_expression has no `function` field — the callee is the
      // first named child (a simple_identifier for `Foo(...)` / a bare call,
      // or a navigation_expression for `obj.method(...)`).
      const callee0 = node.namedChild(0);
      if (callee0) {
        if (callee0.type === "simple_identifier" || callee0.type === "identifier") {
          pushCall(out, callee0.text, callee0);
        } else if (callee0.type === "navigation_expression") {
          pushCall(out, callee0.text.replace(/\s+/g, ""), callee0);
        }
      }
    }
  }

  // ── Java method invocation
  else if (t === "method_invocation") {
    const name = node.childForFieldName("name");
    const obj = node.childForFieldName("object");
    if (name) pushCall(out, obj ? `${obj.text}.${name.text}` : name.text, name);
  }

  // ── C# invocation expression
  else if (t === "invocation_expression") {
    const fn = node.childForFieldName("function");
    if (fn) pushCall(out, fn.text, fn);
  }

  // ── Java + C# constructor call: new Foo(...)
  else if (t === "object_creation_expression") {
    let typeNode: TSNode | null = node.childForFieldName("type");
    if (!typeNode) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (
          c &&
          (c.type === "identifier" ||
            c.type === "type_identifier" ||
            c.type === "scoped_identifier" ||
            c.type === "qualified_name" ||
            c.type === "generic_type")
        ) {
          typeNode = c;
          break;
        }
      }
    }
    if (typeNode) pushCall(out, `new ${typeNode.text}`, typeNode);
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) collectCalls(c, out);
  }
}

// ─── Function-node finder ─────────────────────────────────────────────────────

const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",        // TS / JS / Go
  "generator_function_declaration",
  "method_definition",           // TS / JS class member
  "method_signature",
  "abstract_method_signature",
  "function_definition",         // Python
  "async_function_definition",   // Python async
  "method_declaration",          // Go / Java / C#
  "constructor_declaration",     // Java / C#
  "function_item",               // Rust
]);

function findFunctionNode(root: TSNode, name: string): TSNode | null {
  function walk(node: TSNode): TSNode | null {
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      const named = node.childForFieldName("name");
      if (named?.text === name) return node;
      // Kotlin: function_declaration exposes its name as a simple_identifier
      // child, not via a `name` field.
      if (!named && node.type === "function_declaration") {
        const id = node.namedChild(0);
        if (id?.type === "simple_identifier" && id.text === name) return node;
      }
    }
    // const foo = () => ... | const foo = function() ...
    if (node.type === "variable_declarator") {
      const declName = node.childForFieldName("name")?.text;
      const value = node.childForFieldName("value");
      if (
        declName === name &&
        value &&
        (value.type === "arrow_function" ||
          value.type === "function" ||
          value.type === "function_expression")
      ) {
        return value;
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) {
        const found = walk(c);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(root);
}

// ─── Destructuring alias tracker (TS/JS only) ─────────────────────────────────

function collectDestructuredAliases(
  node: TSNode,
  importMap: Map<string, ImportRef>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  function walk(n: TSNode): void {
    if (n.type === "variable_declarator") {
      const nameNode = n.childForFieldName("name");
      const valueNode = n.childForFieldName("value");
      if (nameNode && valueNode && nameNode.type === "object_pattern") {
        const baseName = valueNode.text.split(".")[0];
        const originRef = importMap.get(baseName);
        const origin = originRef?.from ?? aliases.get(baseName);
        if (origin) {
          for (let i = 0; i < nameNode.namedChildCount; i++) {
            const prop = nameNode.namedChild(i);
            if (!prop) continue;
            if (
              prop.type === "shorthand_property_identifier_pattern" ||
              prop.type === "shorthand_property_identifier"
            ) {
              aliases.set(prop.text, origin);
            }
            if (prop.type === "pair_pattern") {
              const val = prop.childForFieldName("value");
              if (val) aliases.set(val.text, origin);
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) walk(c);
    }
  }
  walk(node);
  return aliases;
}

// ─── Base identifier of a callee expression ───────────────────────────────────

/** Take the leftmost identifier from "obj.method" / "Pkg::func" / "new Foo". */
function baseNameOf(callee: string): string {
  let s = callee;
  if (s.startsWith("new ")) s = s.slice(4);
  return s.split(/::|\./)[0];
}


// ─── Cross-language calledBy scan helper ──────────────────────────────────────

/** Last segment of a member-style callee — "Helper.fmt" -> "fmt", "compute" -> null. */
function memberOf(callee: string): string | null {
  const noNew = callee.startsWith("new ") ? callee.slice(4) : callee;
  const parts = noNew.split(/::|\./);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

/**
 * Open a file, parse it, and check whether any call expression references
 * `funcName` — either as a bare call `funcName(...)` or as the trailing
 * member of a qualified call `X.funcName(...)` / `X::funcName(...)`.
 * Used for C# / Go reverse calledBy where namespace/package imports do not
 * name the called symbol.
 */
async function fileCallsSymbol(fileAbs: string, funcName: string): Promise<boolean> {
  const lang = detectLanguage(fileAbs);
  if (!lang) return false;
  let src: string;
  try {
    src = fs.readFileSync(fileAbs, "utf8");
  } catch {
    return false;
  }
  const root = await parseSource(lang.grammar, src);
  const calls: RawCall[] = [];
  collectCalls(root, calls);
  for (const c of calls) {
    if (c.callee === funcName) return true;
    const m = memberOf(c.callee);
    if (m === funcName) return true;
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Recursively find the first symbol with the given name and return its decorators. */
function findDecorators(symbols: SkeletonFile["symbols"], name: string): string[] | undefined {
  for (const s of symbols) {
    if (s.name === name && s.decorators && s.decorators.length > 0) return s.decorators;
    const nested = findDecorators(s.children, name);
    if (nested) return nested;
  }
  return undefined;
}

export async function buildCallGraph(
  filePath: string,
  funcName: string,
  root: string,
  allSkeletons?: SkeletonFile[],
): Promise<CallGraphResult | null> {
  const langEntry = detectLanguage(filePath);
  if (!langEntry) return null;

  const source = fs.readFileSync(filePath, "utf8");
  const relPath = path.relative(root, filePath).split(path.sep).join("/");
  const rootNode = await parseSource(langEntry.grammar, source);

  const funcNode = findFunctionNode(rootNode, funcName);
  if (!funcNode) return null;

  const body = funcNode.childForFieldName("body") ?? funcNode;

  const rawCalls: RawCall[] = [];
  collectCalls(body, rawCalls);

  const opts = resolveOptions({ detail: "outline", emitHtml: false }, loadProjectConfig(root));
  const skel = await buildSkeleton(filePath, relPath, opts);

  // localName -> full ImportRef (so cross-lang resolution has the flags it needs)
  const importMap = new Map<string, ImportRef>();
  for (const imp of skel.imports ?? []) {
    if (imp.symbol !== "*" && !imp.isSideEffect) {
      importMap.set(imp.alias ?? imp.symbol, imp);
    }
  }

  const localNames = new Set(skel.symbols.map((s) => s.name));
  const destructuredAliases = collectDestructuredAliases(body, importMap);

  // Build cross-lang index lazily — needed for Java/C#/Rust dispatch.
  const isCrossLang = CROSS_LANG.has(skel.language);
  const crossIndex = isCrossLang ? await getOrBuildCrossLangIndex(root) : null;

  const calls: CallRef[] = [];
  const seen = new Set<string>();

  for (const { callee, line } of rawCalls) {
    const key = `${callee}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const base = baseNameOf(callee);
    const importRef = importMap.get(base);
    const aliasOrigin = destructuredAliases.get(base);

    const call: CallRef = { callee, line };

    if (importRef) {
      if (isCrossLang && crossIndex) {
        const target = resolveCrossLangTarget(importRef, skel, filePath, root, crossIndex);
        if (target) {
          if (target.kind === "symbol") call.calleeFileRel = target.file;
          else if (target.files.length > 0) call.calleeFileRel = target.files[0];
        } else {
          call.isExternal = true;
          call.calleeFileRel = importRef.from;
        }
      } else if (importRef.from.startsWith(".")) {
        const resolvedAbs = resolveImportPath(importRef.from, filePath);
        if (resolvedAbs) {
          call.calleeFileRel = path.relative(root, resolvedAbs).split(path.sep).join("/");
        }
      } else {
        const aliasAbs = resolveAliasedImport(importRef.from, filePath);
        if (aliasAbs) {
          call.calleeFileRel = path.relative(root, aliasAbs).split(path.sep).join("/");
        } else {
          call.isExternal = true;
          call.calleeFileRel = importRef.from;
        }
      }
    } else if (aliasOrigin) {
      // Destructured aliases are TS/JS only (always relative or external).
      if (aliasOrigin.startsWith(".")) {
        const resolvedAbs = resolveImportPath(aliasOrigin, filePath);
        if (resolvedAbs) {
          call.calleeFileRel = path.relative(root, resolvedAbs).split(path.sep).join("/");
        }
      } else {
        const aliasAbs = resolveAliasedImport(aliasOrigin, filePath);
        if (aliasAbs) {
          call.calleeFileRel = path.relative(root, aliasAbs).split(path.sep).join("/");
        } else {
          call.isExternal = true;
          call.calleeFileRel = aliasOrigin;
        }
      }
    } else if (crossIndex && skel.language === "csharp") {
      // C# `using App.Models;` makes types visible without naming them.
      // Try `<usingNs>.<base>` against the type-by-fqn index.
      for (const ns of skel.imports ?? []) {
        if (!ns.isNamespaceImport) continue;
        const f = crossIndex.csharpTypes.get(`${ns.from}.${base}`);
        if (f && f !== skel.file) { call.calleeFileRel = f; break; }
      }
      if (!call.calleeFileRel && localNames.has(base)) call.isLocal = true;
    } else if (crossIndex && skel.language === "java") {
      // Java wildcard import: `import com.example.*;` doesn't name the type.
      for (const wc of skel.imports ?? []) {
        if (wc.symbol !== "*") continue;
        const f = crossIndex.javaFqcn.get(`${wc.from}.${base}`);
        if (f && f !== skel.file) { call.calleeFileRel = f; break; }
      }
      if (!call.calleeFileRel && localNames.has(base)) call.isLocal = true;
    } else if (localNames.has(base)) {
      call.isLocal = true;
    }

    calls.push(call);
  }

  // ── calledBy: who imports this function? ────────────────────────────────
  const calledBy: CalledByRef[] = [];
  if (allSkeletons) {
    for (const otherSkel of allSkeletons) {
      if (otherSkel.file === relPath) continue;
      const otherIsCrossLang = CROSS_LANG.has(otherSkel.language);
      const otherAbs = path.resolve(root, otherSkel.file);

      for (const imp of otherSkel.imports ?? []) {
        const importedName = imp.alias ?? imp.symbol;
        if (importedName !== funcName && imp.symbol !== funcName) continue;

        if (otherIsCrossLang) {
          // Symbol-level cross-lang match only — file/namespace edges are too
          // broad to claim "this file calls funcName".
          if (!crossIndex) continue;
          const target = resolveCrossLangTarget(imp, otherSkel, otherAbs, root, crossIndex);
          if (target && target.kind === "symbol" && target.file === relPath && target.symbol === funcName) {
            calledBy.push({ file: otherSkel.file });
            break;
          }
        } else {
          const resolvedAbs = imp.from.startsWith(".")
            ? resolveImportPath(imp.from, otherAbs)
            : resolveAliasedImport(imp.from, otherAbs);
          if (!resolvedAbs) continue;
          const resolvedRel = path.relative(root, resolvedAbs).split(path.sep).join("/");
          if (resolvedRel === relPath) {
            calledBy.push({ file: otherSkel.file });
            break;
          }
        }
      }
    }
  }

  // Extra pass: for C# / Go, the cross-lang resolver gives file-level targets
  // (namespace / package) so the loop above misses callers that only show up
  // via name-resolution at the call site. Scan candidate files' call sites.
  if (
    allSkeletons &&
    crossIndex &&
    (skel.language === "csharp" || skel.language === "go")
  ) {
    const seenFiles = new Set(calledBy.map((c) => c.file));
    for (const otherSkel of allSkeletons) {
      if (otherSkel.file === relPath) continue;
      if (otherSkel.language !== skel.language) continue;
      if (seenFiles.has(otherSkel.file)) continue;
      const otherAbs = path.resolve(root, otherSkel.file);

      // Confirm this other file imports / uses something that resolves to us.
      let importsUs = false;
      for (const imp of otherSkel.imports ?? []) {
        const target = resolveCrossLangTarget(imp, otherSkel, otherAbs, root, crossIndex);
        if (!target) continue;
        if (target.kind === "file" && target.files.includes(relPath)) {
          importsUs = true;
          break;
        }
        if (target.kind === "symbol" && target.file === relPath) {
          importsUs = true;
          break;
        }
      }
      if (!importsUs) continue;

      if (await fileCallsSymbol(otherAbs, funcName)) {
        calledBy.push({ file: otherSkel.file });
        seenFiles.add(otherSkel.file);
      }
    }
  }

  const decorators = findDecorators(skel.symbols, funcName);

  return {
    file: relPath,
    function: funcName,
    functionRange: {
      startLine: funcNode.startPosition.row + 1,
      endLine: funcNode.endPosition.row + 1,
    },
    ...(decorators ? { decorators } : {}),
    calls,
    calledBy,
  };
}
