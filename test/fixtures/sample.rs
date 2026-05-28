use std::collections::HashMap;
use std::fmt::{Debug, Display};

/// Inventory holds stock state.
pub struct Inventory {
    db: String,
    pub count: i32,
}

pub trait Reader {
    fn read(&self) -> i32;
    fn close(&self) -> bool;
}

pub enum Color {
    Red,
    Green,
}

impl Inventory {
    pub fn reserve(&self, sku: &str) -> bool {
        true
    }
    fn private_helper(&self) {}
}

pub fn top_level(x: i32) -> i32 {
    x * 2
}

const MAX: i32 = 100;
type Id = String;
