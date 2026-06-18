const mongoose = require('mongoose');

const infrastructureSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
    type: {
      type: String,
      enum: ['chapel', 'dormitory', 'lecture_hall', 'library', 'administrative', 'other'],
      default: 'other',
    },
    location: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['operational', 'under_maintenance', 'closed'],
      default: 'operational',
    },
  },
  {
    timestamps: true,
  }
);

const Infrastructure = mongoose.model('Infrastructure', infrastructureSchema);
module.exports = Infrastructure;
