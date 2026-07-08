from .models import Inventory
from pkg.models import Inventory as Inv2


class Service:
    def make(self):
        return Inventory()

    def run(self, inv):
        inv.increment()
