import fs from "node:fs";
import { parseSource } from "./parser.js";
import type { TSNode } from "./parser.js";
import { detectLanguage } from "./registry.js";

export type TypeFlowRole = "param" | "return" | "variable" | "field";

export interface TypeFlowRef {
  file: string;
  symbol: string;
  role: TypeFlowRole;
  /** For params: the parameter name. */
  detail?: string;
  line: number;
}

export interface TypeFlowResult {
  type: string;
  refs: TypeFlowRef[];
}

const FN_TYPES = new Set([
  "function_declaration", "generator_function_declaration", "function_definition",
  "async_function_definition", "method_definition", "method_declaration",
  "constructor_declaration", "function_item",
]);
const ID_TYPES = new Set(["identifier", "simple_identifier"]);
const TYPE_ID_TYPES = new Set(["type_identifier", "identifier"]);
const PARAM_CONTAINERS = new Set([
  "formal_parameters", "parameters", "parameter_list", "function_value_parameters",
]);

function fnName(node: TSNode): string {
  const nm = node.childForFieldName("name");
  if (nm) return nm.text;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === "simple_identifier") return c.text;
  }
  return "(anonymous)";
}

/** Does this type-annotation subtree reference the bare type name `name`? */
function typeRefsName(node: TSNode | null, name: string): boolean {
  if (!node) return false;
  let hit = false;
  const walk = (n: TSNode): void => {
    if (hit) return;
    if (TYPE_ID_TYPES.has(n.type) && n.text === name) { hit = true; return; }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return hit;
}

function paramName(p: TSNode): string | undefined {
  if (ID_TYPES.has(p.type)) return p.text;
  const pat = p.childForFieldName("pattern");
  if (pat && ID_TYPES.has(pat.type)) return pat.text;
  const nm = p.childForFieldName("name");
  if (nm && ID_TYPES.has(nm.type)) return nm.text;
  return undefined;
}

function paramsNode(fn: TSNode): TSNode | null {
  const p = fn.childForFieldName("parameters");
  if (p) return p;
  for (let i = 0; i < fn.namedChildCount; i++) {
    const c = fn.namedChild(i);
    if (c && PARAM_CONTAINERS.has(c.type)) return c;
  }
  return null;
}

export async function traceTypeInFile(
  absPath: string,
  relPath: string,
  typeName: string,
): Promise<TypeFlowRef[]> {
  const lang = detectLanguage(absPath);
  if (!lang) return [];
  const source = fs.readFileSync(absPath, "utf8");
  const root = await parseSource(lang.grammar, source);
  const refs: TypeFlowRef[] = [];

  const walk = (node: TSNode): void => {
    if (FN_TYPES.has(node.type)) {
      const name = fnName(node);
      // return type
      const rt = node.childForFieldName("return_type");
      if (typeRefsName(rt, typeName)) {
        refs.push({ file: relPath, symbol: name, role: "return", line: node.startPosition.row + 1 });
      }
      // params
      const pnode = paramsNode(node);
      if (pnode) {
        for (let i = 0; i < pnode.namedChildCount; i++) {
          const p = pnode.namedChild(i);
          if (!p) continue;
          const ty = p.childForFieldName("type");
          if (typeRefsName(ty, typeName)) {
            const pn = paramName(p);
            refs.push({
              file: relPath, symbol: name, role: "param",
              ...(pn ? { detail: pn } : {}),
              line: p.startPosition.row + 1,
            });
          }
        }
      }
    } else if (node.type === "variable_declarator") {
      const ty = node.childForFieldName("type");
      const nm = node.childForFieldName("name");
      if (ty && nm && typeRefsName(ty, typeName)) {
        refs.push({ file: relPath, symbol: nm.text, role: "variable", line: node.startPosition.row + 1 });
      }
    } else if (node.type === "public_field_definition" || node.type === "field_definition") {
      const ty = node.childForFieldName("type");
      const nm = node.childForFieldName("name");
      if (ty && nm && typeRefsName(ty, typeName)) {
        refs.push({ file: relPath, symbol: nm.text, role: "field", line: node.startPosition.row + 1 });
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return refs;
}
