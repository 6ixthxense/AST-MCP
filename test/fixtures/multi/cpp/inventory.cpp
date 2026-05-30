#include "inventory.h"

namespace app {
    Inventory::Inventory(const std::string& n) : name(n) {}
    bool Inventory::reserve(int qty) { return qty > 0; }
}
