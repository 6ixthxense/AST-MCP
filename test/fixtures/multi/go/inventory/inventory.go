package inventory

type Inventory struct {
	Count int
}

func New() *Inventory {
	return &Inventory{Count: 0}
}

func (i *Inventory) Increment() {
	i.Count++
}
