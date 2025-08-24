const mongoose = require('mongoose');
const OldComplaintType = require('../models/ComplaintType'); // Adjust the path if needed
require('dotenv').config(); // Load environment variables

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

async function oldSeedComplaintTypes() {
  try {
    await OldComplaintType.insertMany([
      {
        name: 'Civil Works',
        departmentEmail: 'civilworks@cu.edu.ng',
        subcategories: ['Nets', 'Doors', 'Windows', 'Painting', 'Renovations']
      },
      {
        name: 'Electrical',
        departmentEmail: 'electrical@cu.edu.ng',
        subcategories: ['Bulbs', 'Fan', 'Sockets']
      },
      {
        name: 'Plumbing',
        departmentEmail: 'plumbing@cu.edu.ng',
        subcategories: ['Pipes', 'Water Leakages']
      },
      {
        name: 'Environmental',
        departmentEmail: 'environmental@cu.edu.ng',
        subcategories: ['Cleaning', 'Lawn Mowing', 'Fumigation']
      },
      {
        name: 'CSIS',
        departmentEmail: 'csis@cu.edu.ng',
        subcategories: ['Wi-Fi']
      },
      {
        name: 'MSS',
        departmentEmail: 'mss@cu.edu.ng',
        subcategories: ['Theft', 'Assault', 'Other Security Issues']
      }
    ]);

    console.log('Complaint types with subcategories added successfully!');
    mongoose.connection.close();
  } catch (error) {
    console.error('Failed to seed complaint types:', error);
    mongoose.connection.close();
  }
}

oldSeedComplaintTypes();
