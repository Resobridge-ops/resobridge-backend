const jwt = require("jsonwebtoken");
const prisma = require("../prisma/client");

// Verifies the JWT and re-fetches the User + active OrganizationMembership
// from the database on every request (rather than trusting the token's
// claims for the request's lifetime). Given the 7-day token expiry, this
// keeps role changes, approvals, and deactivations effective immediately
// instead of waiting up to a week for the old token to expire.
async function authenticate(req, res, next) {
  const authHeader = req.header("Authorization");
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, message: "Access denied. No token provided." });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || user.status !== "ACTIVE") {
    return res.status(401).json({ success: false, message: "User not found or inactive." });
  }

  // SUPERADMIN is a platform-level flag on the account, not a membership —
  // it has no organizationId/departmentId to resolve.
  if (user.isPlatformSuperadmin) {
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformSuperadmin: true,
      role: "SUPERADMIN",
      organizationId: null,
      departmentId: null,
      membershipId: null,
      adminScope: null,
    };
    return next();
  }

  if (!decoded.membershipId) {
    return res.status(401).json({ success: false, message: "Invalid token: missing organization context." });
  }

  const membership = await prisma.organizationMembership.findUnique({
    where: { id: decoded.membershipId },
    include: { adminScope: true },
  });

  if (!membership || membership.organizationId !== decoded.organizationId) {
    return res.status(401).json({ success: false, message: "Membership not found." });
  }

  if (membership.status !== "ACTIVE") {
    return res.status(403).json({ success: false, message: "Your access to this organization has been suspended." });
  }

  if (!membership.isApproved) {
    return res.status(403).json({ success: false, message: "Your account is pending approval." });
  }

  req.user = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isPlatformSuperadmin: false,
    role: membership.role,
    organizationId: membership.organizationId,
    departmentId: membership.departmentId,
    membershipId: membership.id,
    adminScope: membership.adminScope || null,
  };

  next();
}

// Simple allow-list check against req.user.role. Use after authenticate().
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Access denied. Unauthorized role." });
    }
    next();
  };
}

// Pure role-scope check for a department the caller has *already been
// confirmed* to own (org-ownership is checked separately — see
// authorizeDepartment below, which does that DB check before calling this).
// Shared so every route that reaches a department indirectly (area ->
// building -> department, asset -> area -> building -> department) applies
// the exact same scope logic as the middleware, instead of a hand-rolled
// copy that can quietly drift out of sync with it.
//   SUPERADMIN  -> unrestricted (genuinely cross-org platform staff)
//   ORG_ADMIN   -> unrestricted *within their own org*
//   DEPT_ADMIN  -> AdminScope.departmentIds (empty array = all departments in the org)
//   STAFF/REQUESTER -> forced to their own home department
function hasDepartmentAccess(reqUser, departmentId) {
  const { role, departmentId: userDepartmentId, adminScope } = reqUser;

  if (role === "SUPERADMIN" || role === "ORG_ADMIN") return true;

  if (role === "DEPT_ADMIN") {
    // A missing AdminScope row (null) is a misconfigured account and must
    // fail closed. Only an AdminScope that explicitly has an empty
    // departmentIds array means "all departments" — those are not the same
    // thing, even though both look like "no restrictions" at a glance.
    if (!adminScope) return false;
    const scopedIds = adminScope.departmentIds || [];
    if (scopedIds.length === 0) return true; // empty = all departments in the org
    return !departmentId || scopedIds.includes(departmentId);
  }

  // STAFF / REQUESTER
  return !departmentId || departmentId === userDepartmentId;
}

// Resolves a target departmentId from params/body/query, verifies it
// actually belongs to the caller's organization (the one DB-backed check —
// see the module comment above hasDepartmentAccess), then applies the same
// role-scope rules.
async function authorizeDepartment(req, res, next) {
  const { role, organizationId } = req.user;
  const targetDepartmentId =
    req.params.departmentId || req.body.departmentId || req.query.departmentId;

  if (role === "SUPERADMIN") {
    return next();
  }

  if (targetDepartmentId) {
    const department = await prisma.department.findFirst({
      where: { id: targetDepartmentId, organizationId },
    });
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found." });
    }
  }

  if (role === "DEPT_ADMIN" && !req.user.adminScope) {
    return res.status(403).json({ success: false, message: "No admin scope configured for this account." });
  }

  if (!hasDepartmentAccess(req.user, targetDepartmentId)) {
    return res.status(403).json({ success: false, message: "Access denied for this department." });
  }

  next();
}

module.exports = { authenticate, authorizeRoles, authorizeDepartment, hasDepartmentAccess };
