const mongoose = require("mongoose");

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  code: {
    type: String,
    required: true,
    unique: true,
  },
  description: {
    type: String,
  },
  email: {
    type: String,
    required: true,
  },
  staffIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  categoryIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DepartmentCategory",
    },
  ],
  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },
}, { timestamps: true });

const Department = mongoose.model("Department", departmentSchema);
module.exports = Department;
