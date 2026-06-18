require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("./models/User");

async function createTestUser() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Check if test user already exists
    const existingUser = await User.findOne({ email: "test@example.com" });
    if (existingUser) {
      console.log("Test user already exists!");
      console.log("Email: test@example.com");
      console.log("Password: password123");
      console.log("Role: student");
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash("password123", 10);

    // Create test user
    const testUser = new User({
      fullName: "Test User",
      email: "test@example.com",
      password: hashedPassword,
      role: "student",
      studentId: "STU001",
      hallId: new mongoose.Types.ObjectId('679a47e114e2785a92e104b1'), // Paul Hall
      approved: true, // Students don't need approval
    });

    await testUser.save();
    console.log("✅ Test user created successfully!");
    console.log("Email: test@example.com");
    console.log("Password: password123");
    console.log("Role: student");

    // Create admin user
    const adminUser = new User({
      fullName: "Admin User",
      email: "admin@example.com",
      password: hashedPassword,
      role: "admin",
      approved: true,
    });

    await adminUser.save();
    console.log("✅ Admin user created successfully!");
    console.log("Email: admin@example.com");
    console.log("Password: password123");
    console.log("Role: admin");

    // Create hall porter user
    const porterUser = new User({
      fullName: "Hall Porter",
      email: "porter@example.com",
      password: hashedPassword,
      role: "hallporter",
      staffId: "HP001",
      hallId: new mongoose.Types.ObjectId('679a47e114e2785a92e104b1'), // Paul Hall
      isApproved: true,
    });

    await porterUser.save();
    console.log("✅ Hall Porter user created successfully!");
    console.log("Email: porter@example.com");
    console.log("Password: password123");
    console.log("Role: hallporter");

  } catch (error) {
    console.error("Error creating test user:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

createTestUser(); 