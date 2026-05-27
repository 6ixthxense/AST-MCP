import { doB } from "./cycle-b.js";

export function doA(): string {
  return doB();
}
