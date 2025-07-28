const mongoose = require("mongoose");

const pendingStudentSchema = new mongoose.Schema({
  fullName: String,
  email: { type: String, unique: true },
  studentId: String,
  hallId: mongoose.Schema.Types.ObjectId,
  password: String,
  createdAt: { type: Date, default: Date.now, expires: 600 } // TTL: 10 min
});

module.exports = mongoose.model("PendingStudent", pendingStudentSchema);
