package com.example;

import java.util.List;
import java.util.Map;

/** InventoryService manages stock. */
public class InventoryService implements Reader {
    private String db;
    public static final int MAX = 100;

    public InventoryService(String db) {
        this.db = db;
    }

    public boolean reserve(String sku, int qty) {
        return qty > 0;
    }

    private void helper() {}
}

interface Reader {
    int read();
    void close();
}

enum Color {
    RED,
    GREEN
}
