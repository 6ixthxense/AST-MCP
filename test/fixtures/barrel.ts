// Barrel file — re-exports from other modules.
// Tests that export { X } from './foo' and export * from './foo'
// are captured as import edges in the skeleton.
export { UserService } from "./sample.js";
export type { Repository } from "./sample.js";
export * from "./sample.js";
export { DEFAULT_TIMEOUT as TIMEOUT } from "./sample.js";
