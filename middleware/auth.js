const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const PendingHallPorter = require('../models/PendingHallPorter');
const express = require('express');
const router = express.Router();
const secret = process.env.JWT_SECRET;
const Complaint = require('../models/Complaint'); // Assuming you have a Complaint model



const authenticateUser = async (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId);
    if (!req.user) return res.status(401).json({ message: 'User not found' });

    console.log("Auth Header:", req.header("Authorization"));

    next();
  } catch (error) {
    console.error(error); // Log errors to understand what's going wrong
    res.status(400).json({ message: 'Invalid token' });
  }
};

// Role-based access control
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied. Unauthorised role." });
    }
    next();
  };
}


// Staff Registration (Needs Approval)
// router.post("/register/staff", async (req, res) => {
//   const { fullName, email, role, staffId, hallId } = req.body;

  
//   // if (!fullName || !email || !password || !phoneNumber || !staffId || !hallId) {
//   //   return res.status(400).json({ success: false, message: "All fields are required" });
//   // }

//   try {
//     // const hashedPassword = await bcrypt.hash(password, 10);

//     const existingPending = await PendingHallPorter.findOne({ email });
//     const existingUser = await User.findOne({ email });

//     if (existingPending || existingUser) {
//       return res.status(400).json({ success: false, message: "Email already exists." });
//     };


//     const pending = new  PendingHallPorter({
//       fullName,
//       email,
//       // password: hashedPassword,
//       role: "hallporter", // 👈 Default role for staff
//       staffId,
//       hallId,
//       isApproved: false, // 👈 Staff needs approval before login
//     });

//     await pending.save();

//     res.json({ success: true, message: "Registration submitted! Awaiting admin approval." });
//   } catch (error) {
//     console.error("Signup error:", error);
//     res.status(500).json({ success: false, message: "Failed to register." });
//   }
// });

// router.post("/register/staff", async (req, res) => {
//   const { fullName, email, role, staffId, hallId } = req.body;

//   // Validate required fields
//   if (!fullName || !email || !staffId || !hallId || !role) {
//     return res.status(400).json({ success: false, message: "All fields are required" });
//   }

//   try {
//     // Check for existing email
//     const existingPending = await PendingHallPorter.findOne({ email });
//     const existingUser = await User.findOne({ email });
//     if (existingPending || existingUser) {
//       return res.status(400).json({ success: false, message: "Email already exists" });
//     }

//     // Check for existing staffId
//     const existingStaff = await PendingHallPorter.findOne({ staffId });
//     if (existingStaff) {
//       return res.status(400).json({ success: false, message: "Staff ID already exists" });
//     }

//     // Create pending staff entry
//     const pending = new PendingHallPorter({
//       fullName,
//       email,
//       role, // Use role from request, not hardcoded
//       staffId,
//       hallId,
//       isApproved: false,
//     });

//     await pending.save();

//     res.json({ success: true, message: "Registration submitted! Awaiting admin approval." });
//   } catch (error) {
//     console.error("Signup error:", error);
//     res.status(500).json({ success: false, message: `Failed to register: ${error.message}` });
//   }
// });

router.post("/register/staff", async (req, res) => {
  const { fullName, email, role, staffId, hallId } = req.body;

  
  // if (!fullName || !email || !password || !phoneNumber || !staffId || !hallId) {
  //   return res.status(400).json({ success: false, message: "All fields are required" });
  // }

  try {
    // const hashedPassword = await bcrypt.hash(password, 10);

    const existingPending = await PendingHallPorter.findOne({ email });
    const existingUser = await User.findOne({ email });

    if (existingPending || existingUser) {
      return res.status(400).json({ success: false, message: "Email already exists." });
    };


    const pending = new  PendingHallPorter({
      fullName,
      email,
      // password: hashedPassword,
      role: "hallporter", // 👈 Default role for staff
      staffId,
      hallId,
      isApproved: false, // 👈 Staff needs approval before login
    });

    await pending.save();

    res.json({ success: true, message: "Registration submitted! Awaiting admin approval." });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Failed to register." });
  }
});




router.post("/login/staff", async (req, res) => {
  const { email, password } = req.body;
  const staff = await User.findOne({ email, role: 'hallporter' });

  if (!staff) return res.status(400).json({ success: false, message: "Staff not found" });

  if (staff.role === "hallporter" && !staff.isApproved) {  // 👈 Prevents unapproved staff from logging in
    return res.status(403).json({ success: false, message: "Your account is pending approval. Please wait for an admin to approve." });
  }

  const isMatch = await bcrypt.compare(password, staff.password);
  if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials" });

  const token = jwt.sign({ id: staff._id, role: "hallporter", hallId: staff.hallId }, process.env.JWT_SECRET, { expiresIn: "1d" });


  return res.json({ 
    success: true, 
    token, 
    userId: staff._id,    
    role: staff.role,
    hallId: staff.hallId,
    message: "Login successful!" });  
});


router.post("/login/admin", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Only allow login for users with the "admin" or "superadmin" role
    const user = await User.findOne({ email, role: { $in: ["admin"] } });

    if (!user) {
      return res.status(404).json({ message: "Admin account not found." });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    // 🚨 Check if they are using a temp password (require reset)
    if (user.forcePasswordReset) {
      return res.status(403).json({
        message: "You must reset your password before accessing the dashboard.",
        forcePasswordReset: true,
        email: user.email,
      });
    }

    // ✅ Password is okay and no reset needed
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    console.log("Admin trying to log in:", email);
    console.log("Admin role:", user.role);

    console.log("✅ Login passed all checks. Sending response...");


    return res.status(200).json({
      success: true,
      message: "Login successful", 
      token,
      userId: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    });
    


  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ message: "Server error during login." });
  }
});


router.post("/login/superadmin", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email, role: "superadmin" });

    if (!user) {
      return res.status(404).json({ message: "Superadmin account not found." });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("✅ Superadmin logged in:", email);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      userId: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    });
  } catch (error) {
    console.error("Superadmin login error:", error);
    res.status(500).json({ message: "Server error during login." });
  }
});




// router.get('/staff/stats', authenticateToken, async (req, res) => {
//  try {
//     const { hallId } = req.query;
//     if (!hallId) return res.status(400).json({ message: "hallId is required" });

//     const total = await Complaint.countDocuments({ hall: hallId });
//     const pending = await Complaint.countDocuments({ hall: hallId, status: "pending" });
//     const resolved = await Complaint.countDocuments({ hall: hallId, status: "resolved" });

//     console.log("Authenticated User:", req.user); // Should show role

//     res.status(200).json({ total, pending, resolved });
//   } catch (error) {
//     console.error("Error fetching staff stats:", error);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });


router.get('/staff/stats', authenticateToken, async (req, res) => {
  try {
    const { hallId } = req.query;
    if (!hallId) {
      return res.status(400).json({ message: "hallId is required" });
    }

    const total = await Complaint.countDocuments({ hallId });
    const resolved = await Complaint.countDocuments({ hallId, status: "Resolved" });
    const inProgress = await Complaint.countDocuments({ hallId, status: "In Progress" });
    const unresolved = await Complaint.countDocuments({ hallId, status: { $in: ["Pending", "Rejected"] } });

    const recentComplaints = await Complaint.find({ hallId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("title status roomNumber");

    res.status(200).json({
      total,
      resolved,
      inProgress,
      unresolved,
      recentComplaints,
    });

  } catch (error) {
    console.error("Error fetching staff stats:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});



// Updated /verify-token route
router.get("/verify-token", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "No token provided" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, secret);
    return res.json({ 
      message: "Token is valid", 
      role: decoded.role,
      // name: decoded.name
      // 👈 make sure this is included during jwt.sign
    });
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
});


// function authenticateToken(req, res, next) {
//   const authHeader = req.headers["authorization"];
//   const token = authHeader && authHeader.split(" ")[1];

//   if (!token) return res.status(401).json({ message: "Access token missing" });

//   jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
//     if (err) return res.status(403).json({ message: "Invalid token" });
//     req.user = user;
//     next();
//   });
// }

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  console.log("Auth Header:", authHeader); // <--- check if token is even sent
  
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    console.log("No token found");
    return res.status(401).json({ message: "Access token missing" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log("JWT verification error:", err.message);
      return res.status(403).json({ message: "Invalid token" });
    }
    req.user = user;
    console.log("Token verified! User:", user);
    next();
  });
}












module.exports = {
  router,
  authenticateUser,
  authorizeRoles,
  authenticateToken,
};

