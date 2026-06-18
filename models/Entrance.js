const mongoose = require('mongoose');

const entranceSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    count: {
      type: Number,
      default: 1,
    },
    needsMaintenance: {
      type: Boolean,
      default: false,
    },
    willNeedMaintenance: {
      type: Boolean,
      default: false,
    },
    maintenanceDate: {
      type: String,
      default: '',
    },
    condition: {
      type: String,
      enum: ['good', 'medium', 'bad'],
      default: 'good',
    },
    hasEquipment: {
      type: String,
      default: '',
    },
    location: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const Entrance = mongoose.model('Entrance', entranceSchema);
module.exports = Entrance;
