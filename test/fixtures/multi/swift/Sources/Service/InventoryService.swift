import Inventory

public struct InventoryService {
    public func make() -> Inventory {
        return Inventory(name: "widget", count: 0)
    }
}
