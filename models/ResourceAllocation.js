const mongoose = require('mongoose');

// Define schema for resource allocations
const resourceAllocationSchema = new mongoose.Schema({
  resource: { type: String, required: true },
  quantity: { type: Number, required: true },
  hallId: { type: String, required: true },
  allocatedAt: { type: Date, default: Date.now }  // Track when the allocation was made
});

// Create a model from the schema
const ResourceAllocation = mongoose.model('ResourceAllocation', resourceAllocationSchema);

module.exports = ResourceAllocation;
