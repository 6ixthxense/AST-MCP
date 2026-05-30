package com.example

class Inventory(val name: String, var count: Int) {
    fun reserve(qty: Int): Boolean = qty > 0
}
