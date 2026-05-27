package services

import "context"

// InventoryService handles stock-level operations.
type InventoryService struct {
	db       *DB
	cacheTTL int
}

// Reader is a minimal read interface.
type Reader interface {
	Read(p []byte) (int, error)
	Close() error
}

type SKU string

const MaxItems = 1000

// ReserveStock reserves quantity for a SKU.
func (s *InventoryService) ReserveStock(ctx context.Context, sku string, qty int) error {
	return nil
}

func (s *InventoryService) release(sku string) {
}

func NewInventoryService(db *DB) *InventoryService {
	return &InventoryService{db: db}
}
