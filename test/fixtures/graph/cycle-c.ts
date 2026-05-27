import { doA } from "./cycle-a.js";

export function doC(): string {
  return doA();
}
