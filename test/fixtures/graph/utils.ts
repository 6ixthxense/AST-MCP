/** Shared utilities — imported by auth.ts */
export function hashPassword(plain: string): string {
  return `hashed:${plain}`;
}

export function formatDate(d: Date): string {
  return d.toISOString();
}

/** Dead export: nothing imports this */
export function neverUsed(): void {
  console.log("dead");
}

export const MAX_RETRIES = 3;
