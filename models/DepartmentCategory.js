const mongoose = require("mongoose");

const departmentCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    required: true,
  },
  description: {
    type: String,
  },
  subcategories: [
    {
      type: String,
    },
  ],
  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },
}, { timestamps: true });

const DepartmentCategory = mongoose.model("DepartmentCategory", departmentCategorySchema);
module.exports = DepartmentCategory;
