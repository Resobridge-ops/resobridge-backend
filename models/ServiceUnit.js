const mongoose = require('mongoose');

const serviceUnitSchema = new mongoose.Schema(
  {
    infrastructureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Infrastructure',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    serviceType: {
      type: String,
      enum: ['electrical', 'plumbing', 'hvac', 'cleaning', 'security', 'other'],
      default: 'other',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'maintenance'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

const ServiceUnit = mongoose.model('ServiceUnit', serviceUnitSchema);
module.exports = ServiceUnit;
