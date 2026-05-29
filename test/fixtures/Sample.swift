import Foundation
import UIKit

class Inventory {
    var name: String
    init(name: String) { self.name = name }
    func reserve(sku: String, qty: Int) -> Bool { return qty > 0 }
    private func helper() {}
}

protocol Reader {
    func read() -> Int
}

struct Point {
    let x: Int
}

func topLevel(x: Int) -> Int { return x * 2 }
let MAX = 100
