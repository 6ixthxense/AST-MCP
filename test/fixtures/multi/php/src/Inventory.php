<?php

namespace App\Models;

class Inventory {
    public $count = 0;

    public function increment() {
        $this->count++;
    }
}
