const express = require("express");
const Department = require("../models/Department");
const DepartmentCategory = require("../models/DepartmentCategory");
const User = require("../models/User");
const { authenticateToken, authorizeRoles, authorizeRolesByDepartment } = require("../middleware/auth");

const router = express.Router();

// POST /departments - Create a new department (superadmin only)
router.post("/", authenticateToken, authorizeRoles("superadmin"), async (req, res) => {
  try {
    const { name, code, description, email, adminId } = req.body;

    if (!name || !code || !email || !adminId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin user not found" });
    }

    const department = await Department.create({
      name,
      code,
      description,
      email,
      adminId,
      staffIds: [adminId],
    });

    return res.status(201).json({ success: true, data: department });
  } catch (error) {
    console.error("Error creating department:", error);
    return res.status(500).json({ success: false, message: "Failed to create department" });
  }
});

// GET /departments - List all departments (authenticated users)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const departments = await Department.find({ status: "active" })
      .populate("adminId", "fullName email")
      .populate("staffIds", "fullName email role");

    return res.json({ success: true, data: departments });
  } catch (error) {
    console.error("Error fetching departments:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch departments" });
  }
});

// GET /departments/:departmentId - Get single department (auth + department member check)
router.get("/:departmentId", authenticateToken, async (req, res) => {
  try {
    const { departmentId } = req.params;

    const department = await Department.findById(departmentId)
      .populate("adminId", "fullName email")
      .populate("staffIds", "fullName email role")
      .populate("categoryIds", "name description");

    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    return res.json({ success: true, data: department });
  } catch (error) {
    console.error("Error fetching department:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch department" });
  }
});

// PUT /departments/:departmentId - Update department (department_admin or superadmin only)
router.put("/:departmentId", authenticateToken, authorizeRolesByDepartment("department_admin", "superadmin"), async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { name, description, email, status } = req.body;

    const department = await Department.findByIdAndUpdate(
      departmentId,
      { ...(name && { name }), ...(description && { description }), ...(email && { email }), ...(status && { status }) },
      { new: true }
    );

    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    return res.json({ success: true, data: department });
  } catch (error) {
    console.error("Error updating department:", error);
    return res.status(500).json({ success: false, message: "Failed to update department" });
  }
});

// POST /departments/:departmentId/staff - Add staff member (department_admin only)
router.post("/:departmentId/staff", authenticateToken, authorizeRolesByDepartment("department_admin", "superadmin"), async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    if (!department.staffIds.includes(userId)) {
      department.staffIds.push(userId);
      await department.save();
    }

    return res.json({ success: true, data: department });
  } catch (error) {
    console.error("Error adding staff:", error);
    return res.status(500).json({ success: false, message: "Failed to add staff" });
  }
});

// DELETE /departments/:departmentId/staff/:staffId - Remove staff from department
router.delete("/:departmentId/staff/:staffId", authenticateToken, authorizeRolesByDepartment("department_admin", "superadmin"), async (req, res) => {
  try {
    const { departmentId, staffId } = req.params;

    const department = await Department.findByIdAndUpdate(
      departmentId,
      { $pull: { staffIds: staffId } },
      { new: true }
    );

    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    return res.json({ success: true, data: department });
  } catch (error) {
    console.error("Error removing staff:", error);
    return res.status(500).json({ success: false, message: "Failed to remove staff" });
  }
});

// POST /departments/:departmentId/categories - Create complaint category (department_admin only)
router.post("/:departmentId/categories", authenticateToken, authorizeRolesByDepartment("department_admin", "superadmin"), async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { name, description, subcategories } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Category name required" });
    }

    const category = await DepartmentCategory.create({
      name,
      description,
      subcategories: subcategories || [],
      departmentId,
    });

    const department = await Department.findByIdAndUpdate(
      departmentId,
      { $push: { categoryIds: category._id } },
      { new: true }
    );

    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error("Error creating category:", error);
    return res.status(500).json({ success: false, message: "Failed to create category" });
  }
});

// GET /departments/:departmentId/categories - List department's categories
router.get("/:departmentId/categories", authenticateToken, async (req, res) => {
  try {
    const { departmentId } = req.params;

    const categories = await DepartmentCategory.find({ departmentId, status: "active" });

    return res.json({ success: true, data: categories });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch categories" });
  }
});

// PUT /departments/:departmentId/categories/:categoryId - Update category
router.put("/:departmentId/categories/:categoryId", authenticateToken, authorizeRolesByDepartment("department_admin", "superadmin"), async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name, description, subcategories, status } = req.body;

    const category = await DepartmentCategory.findByIdAndUpdate(
      categoryId,
      { ...(name && { name }), ...(description && { description }), ...(subcategories && { subcategories }), ...(status && { status }) },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    return res.json({ success: true, data: category });
  } catch (error) {
    console.error("Error updating category:", error);
    return res.status(500).json({ success: false, message: "Failed to update category" });
  }
});

// DELETE /departments/:departmentId/categories/:categoryId - Delete category
router.delete("/:departmentId/categories/:categoryId", authenticateToken, authorizeRolesByDepartment("department_admin", "superadmin"), async (req, res) => {
  try {
    const { departmentId, categoryId } = req.params;

    await DepartmentCategory.findByIdAndDelete(categoryId);

    await Department.findByIdAndUpdate(
      departmentId,
      { $pull: { categoryIds: categoryId } },
      { new: true }
    );

    return res.json({ success: true, message: "Category deleted" });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({ success: false, message: "Failed to delete category" });
  }
});

module.exports = router;
