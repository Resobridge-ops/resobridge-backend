const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema(
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
    zoneType: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const Zone = mongoose.model('Zone', zoneSchema);
module.exports = Zone;
