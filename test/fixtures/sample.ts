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

const multiply = (a: number, b: number): number => a * b;

export type ID = string | number;

export enum Color {
  Red,
  Green,
  Blue,
}
