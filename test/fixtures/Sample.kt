package com.example

import kotlin.collections.List
import kotlin.io.println

class Inventory(val name: String, var count: Int) {
    fun reserve(sku: String, qty: Int): Boolean = qty > 0
    private fun helper() {}
}

object Constants {
    const val MAX = 100
}

fun topLevel(x: Int): Int = x * 2
