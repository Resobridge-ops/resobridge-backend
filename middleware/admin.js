const express = require("express");
const PendingHallPorter = require("../models/PendingHallPorter");
const User = require("../models/User");
const bcrypt = require("bcrypt");
const { authenticateUser } = require("./auth.js");
const { authorizeRoles } = require("./auth.js");
const sendHpApproval = require("../utils/sendHpApproval");
const sendNewAdminEmail = require("../utils/sendNewAdminEmail");
const Complaint = require("../models/Complaint");

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

router.post(
  "/create-admin",
  authenticateUser,
  authorizeRoles("superadmin"),
  async (req, res) => {
    const { email, fullName } = req.body;

    try {
      // Validate CU email
      // if (!email.endsWith('@covenantuniversity.edu.ng')) {
      //   return res.status(400).json({ error: 'Email must be a valid CU email.' });
      // }

      // Check if already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(409)
          .json({ error: "User with this email already exists." });
      }

      // Generate and hash password
      const tempPassword = generateTempPassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const newAdmin = new User({
        email,
        fullName,
        password: hashedPassword,
        role: "admin",
        isApproved: true,
        forcePasswordReset: true, // Force password reset on first login
      });

      await newAdmin.save();

      // Send temporary credentials via email
      await sendNewAdminEmail(email, fullName, tempPassword);

      res.status(201).json({ message: "Admin account created successfully." });
    } catch (error) {
      console.error("Error creating admin:", error);
      res.status(500).json({ error: "Server error creating admin." });
    }
  }
);


router.get("/complaints", async (req, res) => {
  try {
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
    ]);

    res.status(200).json(complaints);
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
    res.status(200).json(complaintsByHall);
  } catch (error) {
    console.error("❌ Error fetching complaints by hall:", error);
    res.status(500).json({ error: "Failed to fetch complaints by hall" });
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
      resourceUsage,
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

module.exports = router;
