#include <stdio.h>
#include "local.h"

struct Inventory {
    char* name;
    int count;
};

int reserve(struct Inventory* inv, const char* sku, int qty) {
    return 1;
}

static int helper(int x) {
    return x;
}

#define MAX_ITEMS 100
typedef int ItemId;
