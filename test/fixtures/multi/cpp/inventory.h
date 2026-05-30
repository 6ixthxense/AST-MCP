#pragma once
#include <string>

namespace app {
    class Inventory {
    public:
        std::string name;
        Inventory(const std::string& n);
        bool reserve(int qty);
    };
}
