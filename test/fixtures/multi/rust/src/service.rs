use crate::inventory::Inventory;

pub struct Service {
    pub inv: Inventory,
}

pub fn make() -> Service {
    let inv = Inventory::new();
    Service { inv }
}
