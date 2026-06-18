const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    infrastructureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Infrastructure',
      required: true,
      index: true,
    },
    sectionType: {
      type: String,
      enum: ['interior', 'exterior'],
      required: true,
    },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Zone',
      default: null,
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
    condition: {
      type: String,
      enum: ['good', 'medium', 'bad'],
      default: 'good',
    },
    quantity: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

const Item = mongoose.model('Item', itemSchema);
module.exports = Item;
