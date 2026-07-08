require_relative './inventory'

class Service
  def make
    Inventory.new
  end

  def run(inv)
    inv.increment
  end
end
