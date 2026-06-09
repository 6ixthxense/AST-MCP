require 'json'
require_relative './helper'

MAX_RETRIES = 3

module Billing
  class Invoice < Document
    attr_reader :total

    def initialize(total)
      @total = total
    end

    def self.from_json(json)
      new(JSON.parse(json))
    end

    private

    def validate!
      raise unless @total
    end
  end

  def self.module_method
  end
end

def top_level(arg)
  arg * 2
end
