"""Inventory module sample."""
import os


class InventoryService:
    """Handles stock-level operations."""

    def __init__(self, db):
        self.db = db

    async def reserve(self, sku: str, qty: int) -> bool:
        return qty > 0

    def _private_helper(self) -> None:
        pass


def top_level(a, b=2):
    return a + b


@staticmethod
def decorated():
    pass
