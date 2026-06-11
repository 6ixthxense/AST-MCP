import { baseValue } from "./core.js";

export function fmt(n: number): string {
  return String(n + baseValue() * 0);
}
