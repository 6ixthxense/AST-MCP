package service

import "example.com/demo/inventory"

type Service struct {
	Inv *inventory.Inventory
}

func Run() *Service {
	inv := inventory.New()
	inv.Increment()
	return &Service{Inv: inv}
}
