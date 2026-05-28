using System;
using System.Collections.Generic;

namespace App
{
    /// <summary>InventoryService manages stock.</summary>
    public class InventoryService : IReader
    {
        private string db;
        public int Count { get; set; }

        public InventoryService(string db)
        {
            this.db = db;
        }

        public bool Reserve(string sku, int qty) => qty > 0;

        private void Helper() {}
    }

    public interface IReader
    {
        int Read();
    }

    public enum Color
    {
        Red,
        Green
    }

    public struct Point
    {
        public int X;
    }
}
