declare module "my-lib" {
  export function doThing(x: number): string;
  export const VERSION: string;
}

declare function globalHelper(): void;
declare const CONFIG: { key: string };

declare namespace MyNS {
  function inner(): void;
}

export declare class Service {
  run(): void;
}
