// routes/v2/department.routes.js
//
// Department CRUD is ORG_ADMIN-only (per the role capability matrix).
// DepartmentCategory CRUD is ORG_ADMIN, or ADMIN with AdminScope.canManageCategories.
// Deletes are soft (status -> INACTIVE): Department and DepartmentCategory both
// have dependents (buildings, complaints, memberships) that a hard delete would
// either orphan or fail against.

const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");
const { authenticate, authorizeRoles, authorizeDepartment } = require("../../middleware/authenticate");

router.use(authenticate);

function canManageCategoriesFor(reqUser) {
  if (reqUser.role === "ORG_ADMIN") return true;
  if (reqUser.role === "ADMIN") return !!reqUser.adminScope?.canManageCategories;
  return false;
}

// ── Departments ──────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const departments = await prisma.department.findMany({
      where: { organizationId: req.user.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: departments });
  } catch (error) {
    console.error("List departments error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/:departmentId", authorizeDepartment, async (req, res) => {
  try {
    const department = await prisma.department.findFirst({
      where: { id: req.params.departmentId, organizationId: req.user.organizationId },
    });
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found." });
    }
    return res.json({ success: true, data: department });
  } catch (error) {
    console.error("Get department error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/", authorizeRoles("ORG_ADMIN"), async (req, res) => {
  try {
    const { name, code, type, description, email } = req.body;
    if (!name || !code || !type) {
      return res.status(400).json({ success: false, message: "name, code, and type are required." });
    }

    const department = await prisma.department.create({
      data: {
        organizationId: req.user.organizationId,
        name,
        code,
        type,
        description,
        email,
      },
    });
    return res.status(201).json({ success: true, data: department });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "A department with this code already exists." });
    }
    console.error("Create department error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/:departmentId", authorizeRoles("ORG_ADMIN"), authorizeDepartment, async (req, res) => {
  try {
    const department = await prisma.department.findFirst({
      where: { id: req.params.departmentId, organizationId: req.user.organizationId },
    });
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found." });
    }

    const { name, code, type, description, email, status } = req.body;
    const updated = await prisma.department.update({
      where: { id: department.id },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(type !== undefined && { type }),
        ...(description !== undefined && { description }),
        ...(email !== undefined && { email }),
        ...(status !== undefined && { status }),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "A department with this code already exists." });
    }
    console.error("Update department error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.delete("/:departmentId", authorizeRoles("ORG_ADMIN"), authorizeDepartment, async (req, res) => {
  try {
    const department = await prisma.department.findFirst({
      where: { id: req.params.departmentId, organizationId: req.user.organizationId },
    });
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found." });
    }
    await prisma.department.update({ where: { id: department.id }, data: { status: "INACTIVE" } });
    return res.json({ success: true, message: "Department deactivated." });
  } catch (error) {
    console.error("Delete department error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Department categories ───────────────────────────────────

router.get("/:departmentId/categories", authorizeDepartment, async (req, res) => {
  try {
    const categories = await prisma.departmentCategory.findMany({
      where: {
        departmentId: req.params.departmentId,
        organizationId: req.user.organizationId,
        status: "ACTIVE",
      },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: categories });
  } catch (error) {
    console.error("List categories error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/:departmentId/categories", authorizeDepartment, async (req, res) => {
  try {
    if (!canManageCategoriesFor(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to manage categories." });
    }

    const { name, description, subcategories, slaHours } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: "name is required." });
    }

    const category = await prisma.departmentCategory.create({
      data: {
        organizationId: req.user.organizationId,
        departmentId: req.params.departmentId,
        name,
        description,
        subcategories: subcategories || [],
        slaHours,
      },
    });
    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "A category with this name already exists in this department." });
    }
    console.error("Create category error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/:departmentId/categories/:categoryId", authorizeDepartment, async (req, res) => {
  try {
    if (!canManageCategoriesFor(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to manage categories." });
    }

    const category = await prisma.departmentCategory.findFirst({
      where: {
        id: req.params.categoryId,
        departmentId: req.params.departmentId,
        organizationId: req.user.organizationId,
      },
    });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }

    const { name, description, subcategories, slaHours, status } = req.body;
    const updated = await prisma.departmentCategory.update({
      where: { id: category.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(subcategories !== undefined && { subcategories }),
        ...(slaHours !== undefined && { slaHours }),
        ...(status !== undefined && { status }),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "A category with this name already exists in this department." });
    }
    console.error("Update category error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.delete("/:departmentId/categories/:categoryId", authorizeDepartment, async (req, res) => {
  try {
    if (!canManageCategoriesFor(req.user)) {
      return res.status(403).json({ success: false, message: "You do not have permission to manage categories." });
    }

    const category = await prisma.departmentCategory.findFirst({
      where: {
        id: req.params.categoryId,
        departmentId: req.params.departmentId,
        organizationId: req.user.organizationId,
      },
    });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }

    await prisma.departmentCategory.update({ where: { id: category.id }, data: { status: "INACTIVE" } });
    return res.json({ success: true, message: "Category deactivated." });
  } catch (error) {
    console.error("Delete category error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
