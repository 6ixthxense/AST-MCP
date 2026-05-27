import { doC } from "./cycle-c.js";

export function doB(): string {
  return doC();
}
