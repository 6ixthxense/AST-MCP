// User service: manages user lookups with a small cache.
export class UserService {
  private cache: Map<string, string> = new Map();

  async getUser(id: string): Promise<string> {
    return this.cache.get(id) ?? "";
  }

  private evict(id: string): void {
    this.cache.delete(id);
  }
}

export interface Repository {
  find(id: string): string;
  save(value: string): void;
}

export function helper(x: number): number {
  return x * 2;
}

// Non-exported arrow — captured as function with exported=false
const multiply = (a: number, b: number): number => a * b;

// Exported arrow
export const double = (x: number): number => x * 2;

// Exported plain constant — should appear as const symbol
export const DEFAULT_TIMEOUT = 5000;

// Class expression
export const BaseRepo = class implements Repository {
  find(id: string): string { return id; }
  save(_: string): void {}
};

export type ID = string | number;

export enum Color {
  Red,
  Green,
  Blue,
}
