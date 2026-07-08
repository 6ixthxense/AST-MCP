<?php

namespace App\Services;

use App\Models\Inventory;

class InventoryService {
    public function make() {
        return new Inventory();
    }

    public function run(Inventory $inv) {
        $inv->increment();
    }
}
