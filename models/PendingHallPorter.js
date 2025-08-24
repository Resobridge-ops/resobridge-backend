const mongoose = require("mongoose");

const pendingHallPorterSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  password: { type: String, required: false },
  staffId: { type: String, required: true },
  hallId: { type: String, required: true },
  requestDate: { type: Date, default: Date.now },
  isApproved: { type: Boolean, default: false },  // Track approval status
});

module.exports = mongoose.model("PendingHallPorter", pendingHallPorterSchema);
