const mongoose = require('mongoose');

const itemDetailSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      unique: true,
      index: true,
    },
    totalCost: {
      type: mongoose.Decimal128,
      default: 0,
      get: (value) => value ? value.toString() : '0',
    },
    totalNumber: {
      type: String,
      default: '',
    },
    costOfMaintenance: {
      type: mongoose.Decimal128,
      default: 0,
      get: (value) => value ? value.toString() : '0',
    },
    lastInspected: {
      type: String,
      default: '',
    },
    nextInspectionDue: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

const ItemDetail = mongoose.model('ItemDetail', itemDetailSchema);
module.exports = ItemDetail;
