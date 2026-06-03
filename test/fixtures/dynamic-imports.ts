import { foo } from "./static";

export async function load() {
  const mod = await import("./dynamic");
  return mod;
}

export function lazy() {
  return import("./lazy-route");
}

const cjs = require("./common");
const ext = require("lodash");
