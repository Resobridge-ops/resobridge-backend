const mongoose = require('mongoose');

const complaintTypeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  departmentEmail: { type: String, required: true },  // Email of the department in charge
  subcategories: [{ type: String }] // Added subcategories array
});

const ComplaintType = mongoose.model('ComplaintType', complaintTypeSchema);
module.exports = ComplaintType;
