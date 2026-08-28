const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  roomNumber: { type: String, required: true },
  category: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // resource: { type: String, required: true },
  status: { type: String, enum: ["Pending", "In Progress", "Awaiting Confirmation", "Resolved", "Disputed", "Rejected"],
    default: "Pending",},
  complaintTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'ComplaintType', required: true },
  hallId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hall', required: true },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  imageUrl: { type: String },
  votes: { type: Number, default: 1 },
  disputeReason: { type: String },
  disputeEvidence: { type: String },
  disputedAt: { type: Date },

}, { timestamps: true });

const Complaint = mongoose.model('Complaint', complaintSchema);
module.exports = Complaint;