export function simple(x) {
  return x;
}

export function branchy(n, items) {
  if (n > 0 && n < 10) return "a";
  for (const i of items) {
    if (i) continue;
  }
  return n > 5 ? "h" : "l";
}

// Nested functions: each must be scored on its own control flow, and each must
// appear as its own entry. Before, `wrapper` absorbed all of `nested`'s
// branches and `nested` was never reported.
export function wrapper(items) {
  const nested = (x) => {
    if (x > 1) return 1;
    if (x > 2) return 2;
    if (x > 3) return 3;
    return 0;
  };
  return items.map(nested);
}

export function ownBranchPlusNested(n) {
  const helper = (x) => (x > 0 ? 1 : 0);
  if (n > 10) return helper(n);
  return 0;
}
