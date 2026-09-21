// routes/v2/admin.routes.js
//
// Dashboard stats, staff management (list/approve-adjacent status changes/
// AdminScope), scoped complaint reporting, and SUPERADMIN organization
// management. Deliberately NOT built here: Plan/Subscription billing CRUD —
// those tables exist in the schema for later, but building billing routes
// wasn't asked for and would be scope creep beyond the core complaint/
// facilities platform.

const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const router = express.Router();
const prisma = require("../../prisma/client");
const { authenticate, authorizeRoles, hasDepartmentAccess } = require("../../middleware/authenticate");
const { sendAdminAccountEmail } = require("../../utils/sendEmail");

router.use(authenticate);

function generateTempPassword() {
  return crypto.randomBytes(6).toString("hex");
}

// ── Dashboard ────────────────────────────────────────────────
// One endpoint, permission-adaptive: returns both the stats and an
// isAdmin flag so the frontend can render conditionally instead of hitting
// a different endpoint per role. Per TARGET.md, DEPT_ADMIN has full rights
// within their scoped department(s) — no per-capability matrix — so
// "admin or not" plus department scope is the complete picture; there's
// nothing finer-grained left to report here.

router.get("/dashboard", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN", "STAFF"), async (req, res) => {
  try {
    const { role, organizationId, departmentId: userDepartmentId, adminScope } = req.user;

    const isAdmin = role === "ORG_ADMIN" || role === "DEPT_ADMIN";
    const where = { organizationId };

    if (role === "DEPT_ADMIN") {
      if (!adminScope) {
        return res.status(403).json({ success: false, message: "No admin scope configured for this account." });
      }
      const scopedIds = adminScope.departmentIds || [];
      if (scopedIds.length > 0) where.departmentId = { in: scopedIds };
    } else if (role === "STAFF") {
      // Personal performance view, not the department-wide queue (that's
      // GET /complaints) — a dashboard is "how am I doing", not "what's here".
      where.assignedStaffId = req.user.id;
    }

    const [total, byStatusRaw, resolvedComplaints, overdue] = await Promise.all([
      prisma.complaint.count({ where }),
      prisma.complaint.groupBy({ by: ["status"], where, _count: true }),
      prisma.complaint.findMany({
        where: { ...where, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      }),
      prisma.complaint.count({ where: { ...where, dueAt: { lt: new Date() }, status: { not: "RESOLVED" } } }),
    ]);

    const byStatus = byStatusRaw.reduce((acc, row) => {
      acc[row.status] = row._count;
      return acc;
    }, {});

    const resolutionRate = total > 0 ? Math.round(((byStatus.RESOLVED || 0) / total) * 100) : 0;
    const avgResolutionHours = resolvedComplaints.length
      ? Math.round(
          (resolvedComplaints.reduce((sum, c) => sum + (c.resolvedAt - c.createdAt), 0) /
            resolvedComplaints.length /
            (1000 * 60 * 60)) *
            10
        ) / 10
      : null;

    let categoryBreakdown;
    if (isAdmin) {
      const grouped = await prisma.complaint.groupBy({ by: ["categoryId"], where, _count: true });
      const categories = await prisma.departmentCategory.findMany({
        where: { id: { in: grouped.map((g) => g.categoryId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(categories.map((c) => [c.id, c.name]));
      categoryBreakdown = grouped.map((g) => ({
        categoryId: g.categoryId,
        categoryName: nameById.get(g.categoryId) || "Unknown",
        count: g._count,
      }));
    }

    return res.json({
      success: true,
      data: {
        stats: {
          total,
          byStatus,
          resolutionRate,
          avgResolutionHours,
          overdue,
          ...(categoryBreakdown && { categoryBreakdown }),
        },
        isAdmin,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Staff management ─────────────────────────────────────────

router.get("/staff", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const { role, organizationId, adminScope } = req.user;
    if (role === "DEPT_ADMIN" && !adminScope) {
      return res.status(403).json({ success: false, message: "No admin scope configured for this account." });
    }
    const scopedIds = role === "DEPT_ADMIN" ? adminScope.departmentIds || [] : [];

    const memberships = await prisma.organizationMembership.findMany({
      where: {
        organizationId,
        role: { in: ["STAFF", "DEPT_ADMIN"] },
        userId: { not: req.user.id },
        ...(scopedIds.length > 0 && { departmentId: { in: scopedIds } }),
      },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        department: { select: { id: true, name: true } },
        adminScope: true,
      },
      orderBy: { joinedAt: "desc" },
    });
    return res.json({ success: true, data: memberships });
  } catch (error) {
    console.error("List staff error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/staff/pending", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const { role, organizationId, adminScope } = req.user;
    if (role === "DEPT_ADMIN" && !adminScope) {
      return res.status(403).json({ success: false, message: "No admin scope configured for this account." });
    }
    const scopedIds = role === "DEPT_ADMIN" ? adminScope.departmentIds || [] : [];

    const pending = await prisma.pendingUser.findMany({
      where: {
        organizationId,
        role: { in: ["STAFF", "DEPT_ADMIN"] },
        ...(scopedIds.length > 0 && { departmentId: { in: scopedIds } }),
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ success: true, data: pending });
  } catch (error) {
    console.error("List pending staff error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// DEPT_ADMIN can only flip status (activate/deactivate) within their
// scope — no separate canManageStaff flag needed, that's just what being a
// DEPT_ADMIN means now. Role/department/position changes are ORG_ADMIN-
// only, and neither can touch an ORG_ADMIN membership through this
// endpoint.
router.patch("/staff/:membershipId", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const membership = await prisma.organizationMembership.findFirst({
      where: { id: req.params.membershipId, organizationId: req.user.organizationId },
    });
    if (!membership) return res.status(404).json({ success: false, message: "Membership not found." });
    if (membership.role === "ORG_ADMIN") {
      return res.status(403).json({ success: false, message: "Cannot modify an ORG_ADMIN membership through this endpoint." });
    }

    if (req.user.role === "DEPT_ADMIN") {
      if (!hasDepartmentAccess(req.user, membership.departmentId)) {
        return res.status(403).json({ success: false, message: "This member is outside your admin scope." });
      }
      const { status } = req.body;
      if (!status) return res.status(400).json({ success: false, message: "status is required." });
      const updated = await prisma.organizationMembership.update({ where: { id: membership.id }, data: { status } });
      return res.json({ success: true, data: updated });
    }

    // ORG_ADMIN: full edit
    const { role, departmentId, position, status, memberId } = req.body;
    if (departmentId) {
      const department = await prisma.department.findFirst({
        where: { id: departmentId, organizationId: req.user.organizationId },
      });
      if (!department) return res.status(404).json({ success: false, message: "Department not found." });
    }
    if (role && !["STAFF", "DEPT_ADMIN"].includes(role)) {
      return res.status(400).json({ success: false, message: "role must be STAFF or DEPT_ADMIN." });
    }

    const updated = await prisma.organizationMembership.update({
      where: { id: membership.id },
      data: {
        ...(role !== undefined && { role }),
        ...(departmentId !== undefined && { departmentId }),
        ...(position !== undefined && { position }),
        ...(status !== undefined && { status }),
        ...(memberId !== undefined && { memberId }),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update staff error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// Department scoping only — a DEPT_ADMIN has full rights within whichever
// department(s) this sets (empty = every department in the org). See
// TARGET.md: the earlier per-capability matrix is deliberately gone.
router.patch("/staff/:membershipId/scope", authorizeRoles("ORG_ADMIN"), async (req, res) => {
  try {
    const membership = await prisma.organizationMembership.findFirst({
      where: { id: req.params.membershipId, organizationId: req.user.organizationId, role: "DEPT_ADMIN" },
    });
    if (!membership) return res.status(404).json({ success: false, message: "Department admin membership not found." });

    const { departmentIds } = req.body;

    if (departmentIds && departmentIds.length > 0) {
      const count = await prisma.department.count({
        where: { id: { in: departmentIds }, organizationId: req.user.organizationId },
      });
      if (count !== departmentIds.length) {
        return res.status(400).json({ success: false, message: "One or more departmentIds are invalid for this organization." });
      }
    }

    const scope = await prisma.adminScope.upsert({
      where: { membershipId: membership.id },
      update: {
        ...(departmentIds !== undefined && { departmentIds }),
      },
      create: {
        membershipId: membership.id,
        departmentIds: departmentIds || [],
      },
    });
    return res.json({ success: true, data: scope });
  } catch (error) {
    console.error("Update admin scope error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Reports ──────────────────────────────────────────────────

router.get("/reports/complaints", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const { role, organizationId, adminScope } = req.user;
    if (role === "DEPT_ADMIN" && !adminScope) {
      return res.status(403).json({ success: false, message: "No admin scope configured for this account." });
    }
    const scopedIds = role === "DEPT_ADMIN" ? adminScope.departmentIds || [] : [];
    const where = { organizationId, ...(scopedIds.length > 0 && { departmentId: { in: scopedIds } }) };

    const complaints = await prisma.complaint.findMany({
      where,
      include: { category: true, department: true, area: true, member: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ success: true, data: complaints });
  } catch (error) {
    console.error("Report export error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── SUPERADMIN: organization management ─────────────────────

router.post("/organizations", authorizeRoles("SUPERADMIN"), async (req, res) => {
  try {
    const { name, slug, orgAdminEmail, orgAdminFullName, allowedEmailDomain, registrationMode } = req.body;
    if (!name || !slug || !orgAdminEmail || !orgAdminFullName) {
      return res.status(400).json({ success: false, message: "name, slug, orgAdminEmail, and orgAdminFullName are required." });
    }

    const existingOrg = await prisma.organization.findUnique({ where: { slug } });
    if (existingOrg) return res.status(409).json({ success: false, message: "This slug is already in use." });

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name,
          slug,
          allowedEmailDomain,
          registrationMode: registrationMode || "INVITE_ONLY",
          status: "TRIAL",
        },
      });

      let user = await tx.user.findUnique({ where: { email: orgAdminEmail } });
      let isNewUser = false;
      if (!user) {
        isNewUser = true;
        user = await tx.user.create({
          data: { email: orgAdminEmail, fullName: orgAdminFullName, password: hashedPassword, forcePasswordReset: true },
        });
      }

      const membership = await tx.organizationMembership.create({
        data: { userId: user.id, organizationId: organization.id, role: "ORG_ADMIN", isApproved: true, status: "ACTIVE" },
      });

      return { organization, user, membership, isNewUser };
    });

    if (result.isNewUser) {
      await sendAdminAccountEmail(result.user.email, orgAdminFullName, tempPassword);
    }

    return res.status(201).json({
      success: true,
      data: { organization: result.organization, orgAdminUserId: result.user.id },
    });
  } catch (error) {
    console.error("Create organization error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/organizations", authorizeRoles("SUPERADMIN"), async (req, res) => {
  try {
    const organizations = await prisma.organization.findMany({ orderBy: { createdAt: "desc" } });
    return res.json({ success: true, data: organizations });
  } catch (error) {
    console.error("List organizations error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/organizations/:organizationId", authorizeRoles("SUPERADMIN"), async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
    if (!organization) return res.status(404).json({ success: false, message: "Organization not found." });

    const { status, name, allowedEmailDomain, registrationMode } = req.body;
    const updated = await prisma.organization.update({
      where: { id: organization.id },
      data: {
        ...(status !== undefined && { status }),
        ...(name !== undefined && { name }),
        ...(allowedEmailDomain !== undefined && { allowedEmailDomain }),
        ...(registrationMode !== undefined && { registrationMode }),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update organization error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
