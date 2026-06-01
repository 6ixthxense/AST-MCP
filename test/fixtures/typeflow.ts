function make(): Inventory {
  return new Inventory();
}

function use(inv: Inventory, n: number): void {}

const store: Inventory = make();

class Svc {
  item: Inventory;
}
