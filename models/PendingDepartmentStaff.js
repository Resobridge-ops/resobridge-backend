const mongoose = require("mongoose");

const pendingDepartmentStaffSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: false,
  },
  staffId: {
    type: String,
    required: true,
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    required: true,
  },
  role: {
    type: String,
    enum: ["staff", "department_admin"],
    default: "staff",
  },
  isApproved: {
    type: Boolean,
    default: false,
  },
  position: {
    type: String,
  },
}, { timestamps: true });

const PendingDepartmentStaff = mongoose.model("PendingDepartmentStaff", pendingDepartmentStaffSchema);
module.exports = PendingDepartmentStaff;
