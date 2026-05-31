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
