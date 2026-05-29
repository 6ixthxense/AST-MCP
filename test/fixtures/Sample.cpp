#include <string>
#include "service.hpp"

namespace app {
    class Inventory {
    public:
        std::string name;
        Inventory(const std::string& n) : name(n) {}
        bool reserve(const std::string& sku, int qty);
    private:
        void helper();
    };

    struct Item {
        int id;
    };

    enum Color { Red, Green };

    int compute(int x) { return x * 2; }
}
