using App.Models;

namespace App.Services
{
    public class InventoryService
    {
        public Inventory Make()
        {
            var inv = new Inventory();
            inv.Increment();
            return inv;
        }
    }
}
