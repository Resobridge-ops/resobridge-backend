// models/PendingAdmin.js
const mongoose = require("mongoose");

const PendingAdminSchema = new mongoose.Schema({
  email: String,
  fullName: String,
  password: String,
  position: String, // DSA, residency admin, etc.
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("PendingAdmin", PendingAdminSchema);
