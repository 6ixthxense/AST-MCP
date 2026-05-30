package com.example.services

import com.example.Inventory

class InventoryService {
    fun make(): Inventory {
        return Inventory("widget", 0)
    }
}
