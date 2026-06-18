const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const PendingHallPorter = require("../models/PendingHallPorter");
const PendingStudent = require("../models/PendingStudent");

const router = express.Router();

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Access token missing" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

const authenticateUser = authenticateToken;

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  next();
};

const isValidEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

const loginHandler = async (req, res) => {
  try {
    const { email, password } = req.body;
    let role = req.body.role;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    if (!role) {
      const path = req.path.toLowerCase();
      if (path.endsWith("/staff")) role = "staff";
      else if (path.endsWith("/admin")) role = "admin";
      else if (path.endsWith("/superadmin")) role = "superadmin";
      else role = "student";
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    if (role && user.role !== role) {
      return res.status(400).json({ success: false, message: "Role does not match account type" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    if ((role === "staff" || role === "department_admin") && user.isApproved === false) {
      return res.status(403).json({
        success: false,
        message: "Staff account is pending approval.",
      });
    }

    const accessTokenPayload = {
      id: user._id,
      userId: user._id,
      role: user.role,
      email: user.email,
      name: user.fullName,
    };
    if (user.departmentId) {
      accessTokenPayload.departmentId = user.departmentId;
    }
    const accessToken = jwt.sign(
      accessTokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    const refreshTokenPayload = {
      id: user._id,
      userId: user._id,
      role: user.role,
      email: user.email,
    };
    if (user.departmentId) {
      refreshTokenPayload.departmentId = user.departmentId;
    }
    const refreshToken = jwt.sign(
      refreshTokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    return res.json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        hallId: user.hallId,
        departmentId: user.departmentId,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
};

const registerStudentHandler = async (req, res) => {
  try {
    const { fullName, email, password, studentId, hallId, role } = req.body;
    const normalizedRole = role?.toLowerCase() || "student";

    if (!fullName || !email || !password || !studentId || !hallId) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    if (normalizedRole !== "student") {
      return res.status(400).json({ success: false, message: "Invalid role for student registration" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await PendingStudent.create({
      fullName,
      email,
      password: hashedPassword,
      studentId,
      hallId,
      role: normalizedRole,
      isApproved: false,
    });

    return res.status(201).json({
      success: true,
      message: "Student registered successfully. OTP sent to email.",
    });
  } catch (error) {
    console.error("Student registration error:", error);
    return res.status(500).json({ success: false, message: "Student registration failed" });
  }
};

const registerStaffHandler = async (req, res) => {
  try {
    const { fullName, email, password, staffId, hallId, role } = req.body;
    const normalizedRole = role?.toLowerCase() || "hallporter";

    if (!fullName || !email || !staffId || !hallId) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    if (normalizedRole !== "hallporter") {
      return res.status(400).json({ success: false, message: "Invalid role for staff registration" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Email already exists" });
    }

    await PendingHallPorter.create({
      fullName,
      email,
      staffId,
      hallId,
      role: normalizedRole,
      isApproved: false,
    });

    return res.status(201).json({
      success: true,
      message: "Staff registered successfully. Approval required by admin.",
    });
  } catch (error) {
    console.error("Staff registration error:", error);
    return res.status(500).json({ success: false, message: "Staff registration failed" });
  }
};

router.post("/login", loginHandler);
router.post("/login/staff", loginHandler);
router.post("/login/admin", loginHandler);
router.post("/login/superadmin", loginHandler);
router.post("/register", registerStudentHandler);
router.post("/register/staff", registerStaffHandler);

router.get("/me", authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

router.post("/logout", authenticateToken, (req, res) => {
  res.json({ success: true, message: "Logged out" });
});

router.post("/refresh-token", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: "Refresh token missing" });
  }

  try {
    jwt.verify(refreshToken, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ success: false, message: "Refresh token invalid or expired" });
      }

      const payload = {
        id: decoded.id,
        role: decoded.role,
        email: decoded.email,
        name: decoded.name,
      };
      if (decoded.departmentId) {
        payload.departmentId = decoded.departmentId;
      }

      const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "15m",
      });

      const refreshPayload = {
        id: decoded.id,
        role: decoded.role,
        email: decoded.email,
      };
      if (decoded.departmentId) {
        refreshPayload.departmentId = decoded.departmentId;
      }
      const newRefreshToken = jwt.sign(
        refreshPayload,
        process.env.JWT_SECRET,
        { expiresIn: "30d" },
      );

      return res.json({
        success: true,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    return res.status(500).json({ success: false, message: "Could not refresh token" });
  }
});

const authorizeRolesByDepartment = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Superadmin bypasses department check
  if (req.user.role === "superadmin") {
    return next();
  }

  // Extract departmentId from request (priority: params > body > user)
  const requiredDepartmentId = req.params.departmentId || req.body.departmentId;

  if (!requiredDepartmentId) {
    return res.status(400).json({ success: false, message: "Department ID required" });
  }

  // Check if user's departmentId matches the required departmentId
  if (req.user.departmentId.toString() !== requiredDepartmentId.toString()) {
    return res.status(403).json({ success: false, message: "Access denied: not in this department" });
  }

  next();
};

module.exports = {
  router,
  authenticateUser,
  authorizeRoles,
  authorizeRolesByDepartment,
  authenticateToken,
};
