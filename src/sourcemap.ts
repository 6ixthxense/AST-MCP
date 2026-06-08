import fs from "node:fs";
import path from "node:path";

export interface SourceMapInfo {
  /** The compiled file (relative to root). */
  file: string;
  /** Where the map came from. */
  mapKind: "inline" | "external";
  /** External map file path, when not inline. */
  mapFile?: string;
  /** Original source paths the compiled file maps back to. */
  sources: string[];
  /** Optional original-source contents count (sourcesContent length). */
  hasContent: boolean;
}

function decodeInline(url: string): unknown | null {
  const b64 = url.match(/base64,(.+)$/);
  try {
    if (b64) return JSON.parse(Buffer.from(b64[1], "base64").toString("utf8"));
    const comma = url.indexOf(",");
    if (comma >= 0) return JSON.parse(decodeURIComponent(url.slice(comma + 1)));
  } catch { /* malformed */ }
  return null;
}

/**
 * Read the source map for a compiled JS/CSS file: handles an inline
 * `//# sourceMappingURL=data:...` comment or an external `.map` file, and
 * returns the original source paths it maps back to.
 */
export function readSourceMap(absPath: string, relPath: string): SourceMapInfo | null {
  let src: string;
  try { src = fs.readFileSync(absPath, "utf8"); } catch { return null; }

  const matches = [...src.matchAll(/[#@]\s*sourceMappingURL=([^\s'"]+)/g)];
  if (matches.length === 0) return null;
  const url = matches[matches.length - 1][1];

  let map: any = null;
  let mapKind: "inline" | "external";
  let mapFile: string | undefined;

  if (url.startsWith("data:")) {
    mapKind = "inline";
    map = decodeInline(url);
  } else {
    mapKind = "external";
    mapFile = url;
    try { map = JSON.parse(fs.readFileSync(path.resolve(path.dirname(absPath), url), "utf8")); }
    catch { map = null; }
  }
  if (!map || !Array.isArray(map.sources)) return null;

  const root: string = typeof map.sourceRoot === "string" ? map.sourceRoot.replace(/\/$/, "") : "";
  const sources: string[] = map.sources.map((s: string) =>
    root && !s.startsWith("/") ? root + "/" + s : s,
  );

  return {
    file: relPath,
    mapKind,
    ...(mapFile ? { mapFile } : {}),
    sources,
    hasContent: Array.isArray(map.sourcesContent) && map.sourcesContent.length > 0,
  };
}
