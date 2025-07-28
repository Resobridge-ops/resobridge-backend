const mongoose = require('mongoose'); 
const ComplaintType = require('../models/ComplaintType'); // adjust path as needed
require('dotenv').config(); // Load .env vars

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

async function seedComplaintTypes() {
  try {
    // Optional: wipe old types if you're sure
    await ComplaintType.deleteMany({});

    await ComplaintType.insertMany([
      {
        name: 'Residency',
        departmentEmail: 'residency@cu.edu.ng',
        subcategories: ['Room Allocation', 'Bunk Issues', 'Roommate Conflicts']
      },
      {
        name: 'Attendance',
        departmentEmail: 'attendance@cu.edu.ng',
        subcategories: ['Chapel Attendance', 'Lecture Attendance', 'Medical Absence']
      },
      {
        name: 'Welfare',
        departmentEmail: 'welfare@cu.edu.ng',
        subcategories: ['Food Quality', 'Water Supply', 'Medical Care']
      },
      {
        name: "SEALD (Students' Activities)",
        departmentEmail: 'studentactivities@cu.edu.ng',
        subcategories: ['Associations', 'Fellowships', 'Events', 'Clubs']
      },
      {
        name: 'Maintenance',
        departmentEmail: 'maintenance@cu.edu.ng',
        subcategories: ['Plumbing', 'Electrical', 'Civil Works', 'Environmental']
      },
      {
        name: 'Security',
        departmentEmail: 'mss@cu.edu.ng',
        subcategories: ['Assault', 'Theft', 'Suspicious Activity']
      }
    ]);

    console.log('✅ Complaint types updated successfully!');
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Failed to seed complaint types:', error);
    mongoose.connection.close();
  }
}

seedComplaintTypes();
