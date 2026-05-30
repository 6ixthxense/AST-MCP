import Foundation

public struct Inventory {
    public let name: String
    public var count: Int

    public init(name: String, count: Int) {
        self.name = name
        self.count = count
    }

    public func reserve(_ qty: Int) -> Bool {
        return qty > 0
    }
}
