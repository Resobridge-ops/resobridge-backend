const express = require("express");
const PendingHallPorter = require("../models/PendingHallPorter");
const PendingDepartmentStaff = require("../models/PendingDepartmentStaff");
const User = require("../models/User");
const Department = require("../models/Department");
const bcrypt = require("bcrypt");
const { authenticateUser } = require("./auth.js");
const { authorizeRoles } = require("./auth.js");
const sendHpApproval = require("../utils/sendHpApproval");
const sendNewAdminEmail = require("../utils/sendNewAdminEmail");
const Complaint = require("../models/Complaint");
const Otp = require("../models/Otp");
const sendOtpEmail = require("../utils/sendOTP");


const router = express.Router();

// 📌 Fetch pending hall porter requests (Admin Only)
router.get(
  "/pending-hallporters",
  authenticateUser,
  authorizeRoles("admin", "superadmin"),
  async (req, res) => {
    try {
      const pendingRequests = await PendingHallPorter.find();
      console.log("Pending hall porters:", pendingRequests);
      res.set("Cache-Control", "no-store"); // 👈 Prevents caching
      res.json({ success: true, data: pendingRequests });
    } catch (error) {
      console.error("Error fetching pending requests:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch pending hall porter requests." });
    }
  }
);

//active hall porters

router.get("/porters", async (req, res) => {
  try {
    console.log("📊 Fetching porters data...");
    
    const porters = await User.find({
      role: "hallporter",
      isApproved: true,
    }).select("fullName hallId email staffId");

    console.log("📊 Found porters:", porters.length);

    // const pending = porters.filter((p) => !p.isApproved);

    const pending = await PendingHallPorter.find().select(
      "fullName hallId email staffId"
    );

    console.log("📊 Found pending:", pending.length);

    // Debug: Show all halls and their IDs
    const allHalls = await require("../models/Hall").find({});
    console.log("📊 All halls in database:", allHalls.map(h => ({ name: h.name, id: h._id })));

    // Get resolved complaints count for each porter
    const active = await Promise.all(
      porters.map(async (p) => {
        try {
          console.log(`📊 Processing porter: ${p.fullName}, hallId: ${p.hallId}, type: ${typeof p.hallId}`);
          
          // Count resolved complaints for this porter's hall
          const resolvedCount = await Complaint.countDocuments({
            hallId: p.hallId,
            status: "Resolved"
          });

          // Count total complaints for this porter's hall
          const totalCount = await Complaint.countDocuments({
            hallId: p.hallId
          });

          // Also try to get some sample complaints to debug
          const sampleComplaints = await Complaint.find({ hallId: p.hallId }).limit(3);
          console.log(`📊 Sample complaints for ${p.fullName}:`, sampleComplaints.map(c => ({ id: c._id, hallId: c.hallId, status: c.status })));

          console.log(`📊 Porter ${p.fullName} (${p.hallId}): ${resolvedCount}/${totalCount} complaints`);

          return {
            _id: p._id,
            fullName: p.fullName,
            hallId: p.hallId,
            email: p.email,
            staffId: p.staffId,
            resolved: resolvedCount,
            total: totalCount,
            performance: totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0
          };
        } catch (error) {
          console.error(`❌ Error processing porter ${p.fullName}:`, error);
          return {
      _id: p._id,
      fullName: p.fullName,
      hallId: p.hallId,
      email: p.email,
      staffId: p.staffId,
            resolved: 0,
            total: 0,
            performance: 0
          };
        }
      })
    );

    console.log("📊 Final active porters data:", active);
    res.status(200).json({ pending, active });
  } catch (err) {
    console.error("❌ Error fetching porters:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 📌 Approve a Hall Porter
// PATCH version of approving hall porter
router.patch(
  "/approve-hallporter/:id",
  authenticateUser,
  authorizeRoles("admin", "superadmin"),
  async (req, res) => {
    try {
      const pending = await PendingHallPorter.findById(req.params.id);
      if (!pending) {
        return res.status(404).json({ error: "Hallporter not found." });
      }

      const generatedPassword = Math.random().toString(36).slice(-8); // Generate a simple random password

      const newUser = new User({
        email: pending.email,
        fullName: pending.fullName,
        phoneNumber: pending.phoneNumber,
        staffId: pending.staffId,
        hallId: pending.hallId,
        role: "hallporter",
        password: await bcrypt.hash(generatedPassword, 10),
        isApproved: true,
      });

      await newUser.save();
      await PendingHallPorter.findByIdAndDelete(req.params.id);

      await sendHpApproval(pending.email, generatedPassword); // Send password in approval email

      res.json({
        success: true,
        message: "Hall porter approved and notified.",
      });
    } catch (error) {
      console.error("Error approving hall porter:", error);
      res.status(500).json({ error: "Failed to approve hall porter." });
    }
  }
);

// 📌 Reject a Hall Porter Request
router.delete(
  "/reject-hallporter/:email",
  authenticateUser,
  authorizeRoles("admin", "superadmin"),
  async (req, res) => {
    try {
      const { email } = req.params;
      const request = await PendingHallPorter.findOneAndDelete({ email });

      if (!request) {
        return res.status(404).json({ error: "Request not found." });
      }

      res.json({ success: true, message: "Hall porter request rejected." });
    } catch (error) {
      console.error("Error rejecting hall porter:", error);
      res.status(500).json({ error: "Failed to reject hall porter." });
    }
  }
);

// Helper: generate random temporary password
function generateTempPassword(length = 8) {
  return Math.random().toString(36).slice(-length); // alphanumeric password
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
}


// router.post(
//   "/create-admin",
//   authenticateUser,
//   authorizeRoles("superadmin"),
//   async (req, res) => {
//     const { email } = req.body;

//     try {
//       // Validate CU email
//       // if (!email.endsWith('@covenantuniversity.edu.ng')) {
//       //   return res.status(400).json({ error: 'Email must be a valid CU email.' });
//       // }

//       // Check if already exists
//       const existingUser = await User.findOne({ email });
//       if (existingUser) {
//         return res
//           .status(409)
//           .json({ error: "User with this email already exists." });
//       }

//       // Generate and hash password
//       const tempPassword = generateTempPassword();
//       const hashedPassword = await bcrypt.hash(tempPassword, 10);

//       const newAdmin = new User({
//         email,
//         password: hashedPassword,
//         role: "admin",
//         isApproved: false,
//         forcePasswordReset: true, // Force password reset on first login
//       });

//       await newAdmin.save();

//       // After await newAdmin.save();

// const otp = generateOtp(); // e.g., 6-digit string
// const hashedOtp = await bcrypt.hash(otp, 10);

// // await Otp.create({
// //   email,
// //   otp: hashedOtp,
// //   otpExpiry: Date.now() + 10 * 60 * 1000
// // });

// await Otp.updateOne(
//   { email },
//   {
//     otp: hashedOtp,
//     otpExpiry: Date.now() + 10 * 60 * 1000
//   },
//   { upsert: true }
// );


// await sendOtpEmail(email, otp);

// res.status(201).json({
//   message: "Admin account created successfully. OTP sent.",
//   email
// });


//       // Send temporary credentials via email
//       await sendNewAdminEmail(email, fullName, tempPassword);

//       res.status(201).json({ message: "Admin account created successfully." });
//     } catch (error) {
// console.error("Error creating admin:", error.message, error.stack);
//       res.status(500).json({ error: "Server error creating admin." });
//     }
//   }
// );


// router.post(
//   "/create-admin",
//   authenticateUser,
//   authorizeRoles("superadmin"),
//   async (req, res) => {
//     const { email } = req.body;

//     try {
//       // Check if email already exists in User collection
//       const existingUser = await User.findOne({ email });
//       if (existingUser) {
//         return res.status(409).json({ error: "User with this email already exists." });
//       }

//       // Generate OTP
//       const otp = generateOtp();
//       const hashedOtp = await bcrypt.hash(otp, 10);

//       // Store OTP in Otp collection (replace if already exists)
//       await Otp.updateOne(
//         { email },
//         {
//           otp: hashedOtp,
//           otpExpiry: Date.now() + 10 * 60 * 1000 // 10 mins
//         },
//         { upsert: true }
//       );

//       // Send OTP email
//       await sendOtpEmail(email, otp);

//       res.status(200).json({
//         message: "OTP sent. Complete verification to create admin account.",
//         email
//       });
//     } catch (error) {
//       console.error("Error sending OTP:", error.message);
//       res.status(500).json({ error: "Server error sending OTP." });
//     }
//   }
// );

router.post(
  "/create-admin",
  authenticateUser,
  authorizeRoles("superadmin"),
  async (req, res) => {
    const { email } = req.body;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    try {
      // Check if email already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(409).json({ error: "User with this email already exists." });
      }

      // Generate OTP (ensure it's a string)
      const otp = generateOtp().toString();
      const hashedOtp = await bcrypt.hash(otp, 10);

      // Store OTP in Otp collection
      await Otp.updateOne(
        { email },
        {
          otp: hashedOtp,
          otpExpiry: Date.now() + 10 * 60 * 1000, // 10 mins
        },
        { upsert: true }
      );

      // Send OTP email
      await sendOtpEmail(email, otp);

      res.status(200).json({
        message: "OTP sent. Complete verification to create admin account.",
        email,
      });
    } catch (error) {
      console.error("Error sending OTP:", error.message);
      res.status(500).json({ error: "Server error sending OTP." });
    }
  }
);


// router.post("/verify-admin-otp", async (req, res) => {
//   const { email, otp } = req.body;
//   console.log("REQ BODY:", req.body);
//     console.log("Incoming verification request:", email, otp);



//   try {
//     const otpRecord = await Otp.findOne({ email });
//         console.log("DB OTP record:", otpRecord);

//        if (!otpRecord) {
//       console.log("OTP not found for:", email);
//       return res.status(400).json({ error: "OTP not found." });
//     }

//     if (Date.now() > otpRecord.otpExpiry) {
//       console.log("OTP expired for:", email);
//       return res.status(400).json({ error: "OTP expired." });
//     }

//     console.log("Comparing OTP:", otp, "against hash:", otpRecord.otp);


//    const isMatch = await bcrypt.compare(String(otp).trim(), otpRecord.otp);

//     if (!isMatch) {
//       console.log("OTP mismatch for:", email);
//       console.log("Comparing OTP:", otp, "against hash:", otpRecord.otp);

//       return res.status(400).json({ error: "Invalid OTP." });
//     }

//     // Generate and hash temporary password
//     const tempPassword = generateTempPassword();
//     const hashedPassword = await bcrypt.hash(tempPassword, 10);

//     // Create admin now that OTP is verified
//     const newAdmin = new User({
//       email,
//       password: hashedPassword,
//       role: "admin",
//       isApproved: true,
//       forcePasswordReset: true
//     });

//     await newAdmin.save();

    
//     res.status(201).json({
//       message: "Admin created successfully.",
//       email
//     });
//   } catch (error) {
//     console.error("Error verifying OTP:", error.message);
//     res.status(500).json({ error: "Server error verifying OTP." });
//   }
// });

router.post("/verify-admin-otp", async (req, res) => {
  const { email, otp, password, position } = req.body;
  console.log("REQ BODY:", req.body);

  try {
    const otpRecord = await Otp.findOne({ email });
    console.log("DB OTP record:", otpRecord);

    if (!otpRecord) {
      console.log("OTP not found for:", email);
      return res.status(400).json({ error: "OTP not found." });
    }

    if (Date.now() > otpRecord.otpExpiry) {
      console.log("OTP expired for:", email);
      return res.status(400).json({ error: "OTP expired." });
    }

    console.log("Comparing OTP:", otp, "against hash:", otpRecord.otp);

    const isMatch = await bcrypt.compare(String(otp).trim(), otpRecord.otp);
    if (!isMatch) {
      console.log("OTP mismatch for:", email);
      return res.status(400).json({ error: "Invalid OTP." });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("User already exists:", email);
      return res.status(409).json({ error: "User with this email already exists." });
    }

    // Hash the provided password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin with provided data
    const newAdmin = new User({
      email,
      password: hashedPassword,
      role: "admin",
      position, // Store the position
      isApproved: true,
      forcePasswordReset: false, // No need for temp password
    });

    await newAdmin.save();

    // Optionally, delete the OTP record after successful verification
    await Otp.deleteOne({ email });

    res.status(201).json({
      success: true,
      message: "Admin created successfully.",
      email,
    });
  } catch (error) {
    console.error("Error verifying OTP:", error.message);
    res.status(500).json({ error: "Server error verifying OTP." });
  }
});



router.get("/complaints", async (req, res) => {
  try {
    const page = Number(req.query.page) >= 1 ? Math.floor(Number(req.query.page)) : 1;
    const limit = Number(req.query.limit) >= 1 ? Math.min(Math.floor(Number(req.query.limit)), 100) : 20;
    const skip = (page - 1) * limit;
    
    const complaints = await Complaint.aggregate([
      {
        $lookup: {
          from: "halls",
          localField: "hallId", // 🔥 Correct field
          foreignField: "_id",
          as: "hallInfo",
        },
      },
      {
        $lookup: {
          from: "complainttypes", // 🔥 or "complainttypes" depending on your actual collection name
          localField: "complaintTypeId", // 🔥 Correct field
          foreignField: "_id",
          as: "categoryInfo",
        },
      },
      { $unwind: { path: "$hallInfo", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          complaintId: 1,
          title: 1,
          description: 1,
          roomNumber: 1,
          status: 1,
          createdAt: 1,
          hall: "$hallInfo.name", // 👈 This will now work
          category: "$categoryInfo.name", // 👈 This too
          studentName: 1, // Include student name if available
          student: 1, // Include student object if available
        },
      },
      { $skip: skip },
      { $limit: limit }
    ]);

    const totalResult = await Complaint.aggregate([
      {
        $lookup: {
          from: "halls",
          localField: "hallId",
          foreignField: "_id",
          as: "hallInfo",
        },
      },
      {
        $lookup: {
          from: "complainttypes",
          localField: "complaintTypeId",
          foreignField: "_id",
          as: "categoryInfo",
        },
      },
      { $count: "total" }
    ]);
    
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    res.status(200).json({
      data: complaints,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("Error fetching complaints:", error);
    res.status(500).json({ error: "Failed to fetch complaints" });
  }
});

// Add complaints by hall endpoint for chart data
router.get("/complaints/by-hall", async (req, res) => {
  try {
    console.log("📊 /complaints/by-hall endpoint called");
    
    const complaintsByHall = await Complaint.aggregate([
      {
        $lookup: {
          from: "halls",
          localField: "hallId",
          foreignField: "_id",
          as: "hallInfo",
        },
      },
      { $unwind: { path: "$hallInfo", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$hallInfo.name",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          hallName: "$_id",
          count: 1,
          _id: 0,
        },
      },
    ]);

    console.log("📊 Complaints by hall data:", complaintsByHall);
    console.log("📊 Data length:", complaintsByHall.length);
    res.status(200).json({
      success: true,
      statusCode: 200,
      data: complaintsByHall
    });
  } catch (error) {
    console.error("❌ Error fetching complaints by hall:", error);
    res.status(500).json({ 
      success: false, 
      statusCode: 500, 
      message: "Failed to fetch complaints by hall" 
    });
  }
});



router.get("/analytics", async (req, res) => {
  try {
    // const now = new Date();
    // const oneMonthAgo = new Date();
    // oneMonthAgo.setMonth(now.getMonth() - 1);

    const complaints = await Complaint.aggregate([
      // {
      //   $match: {
      //     createdAt: { $gte: oneMonthAgo },
      //   },
      // },
      // Convert string ID to ObjectId for category
      {
        $addFields: {
          categoryObjId: { $toObjectId: "$category" },
        },
      },
      {
        $lookup: {
          from: "halls",
          localField: "hallId",
          foreignField: "_id",
          as: "hallInfo",
        },
      },
      {
        $lookup: {
          from: "complainttypes",
          localField: "categoryObjId",
          foreignField: "_id",
          as: "categoryInfo",
        },
      },
      { $unwind: { path: "$hallInfo", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          updatedAt: 1,
          status: 1,
          hall: "$hallInfo.name",
          category: "$categoryInfo.name",
        },
      },
    ]);

    const totalComplaints = complaints.length;
    const resolvedComplaints = complaints.filter(c => c.status === "Resolved").length;
    const resolutionRate = totalComplaints
      ? Math.round((resolvedComplaints / totalComplaints) * 100)
      : 0;

    let totalResolutionTime = 0;
    let resolvedCount = 0;

    complaints.forEach((c) => {
      if (c.status === "Resolved" && c.updatedAt && c.createdAt) {
        const diff = (new Date(c.updatedAt) - new Date(c.createdAt)) / (1000 * 60 * 60 * 24);
        totalResolutionTime += diff;
        resolvedCount++;
      }
    });

    const avgResolutionTime = resolvedCount
      ? parseFloat((totalResolutionTime / resolvedCount).toFixed(1))
      : "—";

    const categoryMap = {};
    complaints.forEach((c) => {
      if (c.category) {
        categoryMap[c.category] = (categoryMap[c.category] || 0) + 1;
      }
    });

    const categoryStats = Object.entries(categoryMap).map(([name, count]) => ({
      name,
      count,
      percentage: parseFloat(((count / totalComplaints) * 100).toFixed(1)),
    }));

    const hallMap = {};
complaints.forEach((c) => {
  if (c.hall) {
    hallMap[c.hall] = (hallMap[c.hall] || 0) + 1;
  }
});

const hallStats = Object.entries(hallMap).map(([hallName, count]) => ({
  hallName,
  count,
  percentage: parseFloat(((count / totalComplaints) * 100).toFixed(1)),
}));


    const resourceUsage = [
      { name: "Electricians", usage: 72 },
      { name: "Plumbers", usage: 58 },
      { name: "Technicians", usage: 64 },
    ];

    res.json({
      totalComplaints,
      resolvedComplaints,
      resolutionRate,
      avgResolutionTime,
      categoryStats,
      complaintsByHall: hallStats,
      // resourceUsage,
    });
  } catch (err) {
    console.error("Error fetching analytics:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const user = await User.findOne({
      email,
      role: { $in: ["admin", "superadmin"] },
    });

    if (!user) {
      return res.status(404).json({ message: "Admin not found." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.forcePasswordReset = false; // ✅ Remove reset flag
    await user.save();

    return res.json({
      message: "Password reset successful. You can now log in.",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({ message: "Failed to reset password." });
  }
});

// 📌 Fetch admin notifications (pending approvals, new registrations, etc.)
router.get("/notifications", authenticateUser, authorizeRoles("admin", "superadmin"), async (req, res) => {
  try {
    // Get pending hall porters
    const pendingHallPorters = await PendingHallPorter.find({}).select("fullName email createdAt");
    
    // Get pending students (if model exists)
    let pendingStudents = [];
    try {
      const PendingStudent = require("../models/PendingStudent");
      pendingStudents = await PendingStudent.find({}).select("fullName email createdAt");
    } catch (err) {
      // PendingStudent model might not be imported
      console.log("PendingStudent model not available");
    }

    // Get pending admins (if model exists)
    let pendingAdmins = [];
    try {
      const PendingAdmin = require("../models/PendingAdmin");
      pendingAdmins = await PendingAdmin.find({}).select("email fullName createdAt");
    } catch (err) {
      // PendingAdmin model might not be imported
      console.log("PendingAdmin model not available");
    }

    // Convert to notification format
    const notifications = [
      ...pendingHallPorters.map((porter) => ({
        _id: porter._id,
        title: "New Hall Porter Pending",
        message: `${porter.fullName} is awaiting approval`,
        type: "pending_hallporter",
        read: false,
        createdAt: porter.createdAt,
      })),
      ...pendingStudents.map((student) => ({
        _id: student._id,
        title: "New Student Registration",
        message: `${student.fullName} needs verification`,
        type: "pending_student",
        read: false,
        createdAt: student.createdAt,
      })),
      ...pendingAdmins.map((admin) => ({
        _id: admin._id,
        title: "New Admin Pending",
        message: `${admin.email} is awaiting approval`,
        type: "pending_admin",
        read: false,
        createdAt: admin.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      notifications,
      count: notifications.length,
    });
  } catch (error) {
    console.error("Error fetching admin notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// 📌 Fetch pending department staff requests (Admin/Department Admin Only)
router.get(
  "/pending-department-staff",
  authenticateUser,
  authorizeRoles("admin", "superadmin", "department_admin"),
  async (req, res) => {
    try {
      const { departmentId } = req.query;
      
      const query = {};
      if (departmentId) {
        query.departmentId = departmentId;
      } else if (req.user.role === "department_admin") {
        query.departmentId = req.user.departmentId;
      }

      const pendingRequests = await PendingDepartmentStaff.find(query)
        .populate("departmentId", "name code");
      
      console.log("Pending department staff:", pendingRequests);
      res.set("Cache-Control", "no-store");
      res.json({ success: true, data: pendingRequests });
    } catch (error) {
      console.error("Error fetching pending department staff:", error);
      res.status(500).json({ error: "Failed to fetch pending department staff requests." });
    }
  }
);

// 📌 Approve pending department staff (Admin/Department Admin Only)
router.post(
  "/approve-department-staff/:staffId",
  authenticateUser,
  authorizeRoles("admin", "superadmin", "department_admin"),
  async (req, res) => {
    try {
      const { staffId } = req.params;

      const pendingStaff = await PendingDepartmentStaff.findById(staffId);
      if (!pendingStaff) {
        return res.status(404).json({ success: false, message: "Pending staff request not found" });
      }

      // Department admin can only approve for their own department
      if (req.user.role === "department_admin" && req.user.departmentId.toString() !== pendingStaff.departmentId.toString()) {
        return res.status(403).json({ success: false, message: "Cannot approve staff for other departments" });
      }

      // Check if email already exists
      const existingUser = await User.findOne({ email: pendingStaff.email });
      if (existingUser) {
        return res.status(409).json({ success: false, message: "Email already registered" });
      }

      // Hash password if provided
      let hashedPassword = null;
      if (pendingStaff.password) {
        hashedPassword = await bcrypt.hash(pendingStaff.password, 10);
      }

      // Create approved user
      const approvedUser = await User.create({
        fullName: pendingStaff.fullName,
        email: pendingStaff.email,
        password: hashedPassword,
        staffId: pendingStaff.staffId,
        role: pendingStaff.role,
        departmentId: pendingStaff.departmentId,
        position: pendingStaff.position,
        isApproved: true,
      });

      // Add to department staff list
      await Department.findByIdAndUpdate(
        pendingStaff.departmentId,
        { $addToSet: { staffIds: approvedUser._id } },
        { new: true }
      );

      // Delete pending request
      await PendingDepartmentStaff.findByIdAndDelete(staffId);

      console.log(`✅ Department staff ${pendingStaff.fullName} approved`);
      res.json({ success: true, message: "Staff approved successfully", user: approvedUser });
    } catch (error) {
      console.error("Error approving department staff:", error);
      res.status(500).json({ success: false, message: "Failed to approve department staff" });
    }
  }
);

// 📌 Reject pending department staff (Admin/Department Admin Only)
router.post(
  "/reject-department-staff/:staffId",
  authenticateUser,
  authorizeRoles("admin", "superadmin", "department_admin"),
  async (req, res) => {
    try {
      const { staffId } = req.params;

      const pendingStaff = await PendingDepartmentStaff.findById(staffId);
      if (!pendingStaff) {
        return res.status(404).json({ success: false, message: "Pending staff request not found" });
      }

      // Department admin can only reject for their own department
      if (req.user.role === "department_admin" && req.user.departmentId.toString() !== pendingStaff.departmentId.toString()) {
        return res.status(403).json({ success: false, message: "Cannot reject staff for other departments" });
      }

      await PendingDepartmentStaff.findByIdAndDelete(staffId);

      console.log(`❌ Department staff ${pendingStaff.fullName} rejected`);
      res.json({ success: true, message: "Staff request rejected successfully" });
    } catch (error) {
      console.error("Error rejecting department staff:", error);
      res.status(500).json({ success: false, message: "Failed to reject department staff" });
    }
  }
);

module.exports = router;
