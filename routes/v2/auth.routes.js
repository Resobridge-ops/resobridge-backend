// routes/v2/auth.routes.js
//
// Scope for this MVP pass: register (REQUESTER, self-serve OTP flow),
// register/staff (STAFF request, admin-approved with a temp password),
// verify-otp, resend-otp, login (single endpoint, resolves org membership
// by organizationSlug or by uniqueness), approve/reject pending staff,
// invitations (create + accept), forgot/reset password.
//
// Deliberately NOT built here: an authenticated "join another organization"
// flow for an email that already has a global account. /register rejects
// that case with a 409 pointing at login instead — see the comment there.

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const router = express.Router();
const prisma = require("../../prisma/client");
const { authenticate, authorizeRoles, hasDepartmentAccess } = require("../../middleware/authenticate");
const {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendStaffApprovalEmail,
  sendInvitationEmail,
} = require("../../utils/sendEmail");

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const PENDING_REQUESTER_EXPIRY_MS = 10 * 60 * 1000;
const PENDING_STAFF_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // awaiting manual approval, not a timed OTP
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const JWT_EXPIRES_IN = "7d";

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateTempPassword() {
  return crypto.randomBytes(6).toString("hex");
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

async function findOrganizationBySlug(slug) {
  if (!slug) return null;
  return prisma.organization.findUnique({ where: { slug } });
}

async function logAudit(data) {
  try {
    await prisma.auditLog.create({ data });
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}

// ── Public org lookup (pre-auth) ────────────────────────────
// Needed by the org-gate and both signup forms: a prospective member or
// staff requester has no account yet, so they can't hit the authenticated
// department.routes.js endpoints. Both routes below return only what's
// needed to resolve context and populate a department picker — nothing
// sensitive (no counts, no internal ids beyond what's required to submit
// the actual registration).

router.get("/organizations/:slug", async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: req.params.slug },
      select: { id: true, name: true, slug: true, registrationMode: true },
    });
    if (!organization) {
      return res.status(404).json({ success: false, message: "Organization not found." });
    }
    return res.json({ success: true, data: organization });
  } catch (error) {
    console.error("Organization lookup error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/organizations/:slug/departments", async (req, res) => {
  try {
    const organization = await findOrganizationBySlug(req.params.slug);
    if (!organization) {
      return res.status(404).json({ success: false, message: "Organization not found." });
    }
    const departments = await prisma.department.findMany({
      where: { organizationId: organization.id, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: departments });
  } catch (error) {
    console.error("Organization department lookup error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── REQUESTER self-registration ───────────────────────────

router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password, organizationSlug } = req.body;
    if (!fullName || !email || !password || !organizationSlug) {
      return res.status(400).json({
        success: false,
        message: "fullName, email, password, and organizationSlug are required.",
      });
    }

    const organization = await findOrganizationBySlug(organizationSlug);
    if (!organization) {
      return res.status(404).json({ success: false, message: "Organization not found." });
    }

    if (organization.registrationMode === "INVITE_ONLY") {
      return res.status(403).json({ success: false, message: "This organization requires an invitation to join." });
    }

    if (organization.registrationMode === "DOMAIN_RESTRICTED" && organization.allowedEmailDomain) {
      const domain = organization.allowedEmailDomain.toLowerCase();
      if (!email.toLowerCase().endsWith(`@${domain}`)) {
        return res.status(400).json({
          success: false,
          message: `Registration is restricted to @${organization.allowedEmailDomain} email addresses.`,
        });
      }
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Log in instead.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.pendingUser.upsert({
      where: { organizationId_email: { organizationId: organization.id, email } },
      update: {
        fullName,
        password: hashedPassword,
        role: "REQUESTER",
        expiresAt: new Date(Date.now() + PENDING_REQUESTER_EXPIRY_MS),
      },
      create: {
        organizationId: organization.id,
        fullName,
        email,
        password: hashedPassword,
        role: "REQUESTER",
        expiresAt: new Date(Date.now() + PENDING_REQUESTER_EXPIRY_MS),
      },
    });

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    await prisma.otp.deleteMany({ where: { email, purpose: "REGISTRATION" } });
    await prisma.otp.create({
      data: {
        email,
        organizationId: organization.id,
        otp: hashedOtp,
        purpose: "REGISTRATION",
        otpExpiry: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    });

    await sendOtpEmail(email, otp);

    return res.status(200).json({ success: true, message: "Registration started. OTP sent to email." });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ success: false, message: "Server error during registration." });
  }
});

// ── STAFF request (no password upfront — issued on approval) ──

router.post("/register/staff", async (req, res) => {
  try {
    const { fullName, email, organizationSlug, departmentId, position } = req.body;
    if (!fullName || !email || !organizationSlug || !departmentId) {
      return res.status(400).json({
        success: false,
        message: "fullName, email, organizationSlug, and departmentId are required.",
      });
    }

    const organization = await findOrganizationBySlug(organizationSlug);
    if (!organization) {
      return res.status(404).json({ success: false, message: "Organization not found." });
    }

    // Same gate as REQUESTER self-registration (TARGET.md: the staff-request
    // path must respect registrationMode the same way) — this used to be
    // ungated entirely, letting anyone request staff access to any org
    // regardless of INVITE_ONLY/DOMAIN_RESTRICTED.
    if (organization.registrationMode === "INVITE_ONLY") {
      return res.status(403).json({ success: false, message: "This organization requires an invitation to join." });
    }
    if (organization.registrationMode === "DOMAIN_RESTRICTED" && organization.allowedEmailDomain) {
      const domain = organization.allowedEmailDomain.toLowerCase();
      if (!email.toLowerCase().endsWith(`@${domain}`)) {
        return res.status(400).json({
          success: false,
          message: `Registration is restricted to @${organization.allowedEmailDomain} email addresses.`,
        });
      }
    }

    const department = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: organization.id },
    });
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found in this organization." });
    }

    const existingPending = await prisma.pendingUser.findUnique({
      where: { organizationId_email: { organizationId: organization.id, email } },
    });
    if (existingPending) {
      return res.status(409).json({ success: false, message: "A request for this email is already pending." });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMembership = await prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: existingUser.id, organizationId: organization.id } },
      });
      if (existingMembership) {
        return res.status(409).json({ success: false, message: "This email is already a member of this organization." });
      }
    }

    await prisma.pendingUser.create({
      data: {
        organizationId: organization.id,
        departmentId,
        fullName,
        email,
        role: "STAFF",
        position,
        expiresAt: new Date(Date.now() + PENDING_STAFF_EXPIRY_MS),
      },
    });

    try {
      const approvers = await prisma.organizationMembership.findMany({
        where: {
          organizationId: organization.id,
          OR: [
            { role: "ORG_ADMIN" },
            { role: "DEPT_ADMIN", adminScope: { departmentIds: { isEmpty: true } } },
            { role: "DEPT_ADMIN", adminScope: { departmentIds: { has: departmentId } } },
          ],
        },
      });
      if (approvers.length > 0) {
        await prisma.notification.createMany({
          data: approvers.map((m) => ({
            organizationId: organization.id,
            userId: m.userId,
            type: "STAFF_INVITED",
            title: "New staff request",
            message: `${fullName} (${email}) has requested a staff account in ${department.name}.`,
          })),
        });
      }
    } catch (notifyError) {
      console.error("Failed to notify approvers of staff request:", notifyError);
    }

    return res.status(200).json({ success: true, message: "Staff request submitted. Awaiting admin approval." });
  } catch (error) {
    console.error("Register staff error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── OTP verification (REQUESTER flow) ───────────────────────

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp, organizationSlug } = req.body;
    if (!email || !otp || !organizationSlug) {
      return res.status(400).json({ success: false, message: "email, otp, and organizationSlug are required." });
    }

    const organization = await findOrganizationBySlug(organizationSlug);
    if (!organization) {
      return res.status(404).json({ success: false, message: "Organization not found." });
    }

    const otpRecord = await prisma.otp.findFirst({
      where: { email, purpose: "REGISTRATION", organizationId: organization.id },
      orderBy: { createdAt: "desc" },
    });
    if (!otpRecord) {
      return res.status(400).json({ success: false, message: "OTP not requested or already used." });
    }
    if (otpRecord.otpExpiry < new Date()) {
      await prisma.otp.delete({ where: { id: otpRecord.id } });
      return res.status(400).json({ success: false, message: "OTP expired, request a new one." });
    }
    const isMatch = await bcrypt.compare(otp, otpRecord.otp);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid OTP." });
    }

    const pendingUser = await prisma.pendingUser.findUnique({
      where: { organizationId_email: { organizationId: organization.id, email } },
    });
    if (!pendingUser) {
      return res.status(400).json({ success: false, message: "No pending registration found." });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const { user, membership } = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: pendingUser.password,
          fullName: pendingUser.fullName,
        },
      });
      const newMembership = await tx.organizationMembership.create({
        data: {
          userId: newUser.id,
          organizationId: organization.id,
          departmentId: pendingUser.departmentId,
          role: pendingUser.role,
          memberId: pendingUser.memberId,
          position: pendingUser.position,
          isApproved: true, // REQUESTER self-registration is auto-approved
          status: "ACTIVE",
        },
      });
      await tx.pendingUser.delete({ where: { id: pendingUser.id } });
      return { user: newUser, membership: newMembership };
    });

    await prisma.otp.delete({ where: { id: otpRecord.id } });

    const token = signToken({
      userId: user.id,
      organizationId: organization.id,
      membershipId: membership.id,
    });

    return res.status(201).json({
      success: true,
      message: "Account verified and created.",
      token,
      role: membership.role,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({ success: false, message: "Server error during verification." });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const { email, organizationSlug } = req.body;
    if (!email || !organizationSlug) {
      return res.status(400).json({ success: false, message: "email and organizationSlug are required." });
    }
    const organization = await findOrganizationBySlug(organizationSlug);
    if (!organization) {
      return res.status(404).json({ success: false, message: "Organization not found." });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "This email is already verified and registered." });
    }

    const pendingUser = await prisma.pendingUser.findUnique({
      where: { organizationId_email: { organizationId: organization.id, email } },
    });
    if (!pendingUser) {
      return res.status(400).json({ success: false, message: "No pending registration found for this email." });
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);
    await prisma.otp.deleteMany({ where: { email, purpose: "REGISTRATION" } });
    await prisma.otp.create({
      data: {
        email,
        organizationId: organization.id,
        otp: hashedOtp,
        purpose: "REGISTRATION",
        otpExpiry: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    });

    await sendOtpEmail(email, otp);
    return res.json({ success: true, message: "OTP resent successfully." });
  } catch (error) {
    console.error("Resend OTP error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Approve / reject a pending STAFF request ────────────────

router.patch("/approve/:pendingUserId", authenticate, authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const pendingUser = await prisma.pendingUser.findUnique({ where: { id: req.params.pendingUserId } });
    if (!pendingUser || pendingUser.organizationId !== req.user.organizationId) {
      return res.status(404).json({ success: false, message: "Pending request not found." });
    }

    if (req.user.role === "DEPT_ADMIN") {
      const scopedIds = req.user.adminScope?.departmentIds || [];
      if (scopedIds.length > 0 && pendingUser.departmentId && !scopedIds.includes(pendingUser.departmentId)) {
        return res.status(403).json({ success: false, message: "This department is outside your admin scope." });
      }
    }

    let user = await prisma.user.findUnique({ where: { email: pendingUser.email } });
    let tempPassword = null;
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      tempPassword = generateTempPassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      user = await prisma.user.create({
        data: {
          email: pendingUser.email,
          fullName: pendingUser.fullName,
          password: hashedPassword,
          forcePasswordReset: true,
        },
      });
    }

    const membership = await prisma.organizationMembership.create({
      data: {
        userId: user.id,
        organizationId: pendingUser.organizationId,
        departmentId: pendingUser.departmentId,
        role: pendingUser.role,
        memberId: pendingUser.memberId,
        position: pendingUser.position,
        isApproved: true,
        status: "ACTIVE",
      },
    });

    await prisma.pendingUser.delete({ where: { id: pendingUser.id } });

    await logAudit({
      organizationId: pendingUser.organizationId,
      actorId: req.user.id,
      action: "APPROVE",
      entityType: "OrganizationMembership",
      entityId: membership.id,
      description: `Approved ${pendingUser.role} request for ${pendingUser.email}`,
    });

    if (isNewUser) {
      await sendStaffApprovalEmail(user.email, tempPassword);
    }

    return res.json({ success: true, message: "Request approved.", membershipId: membership.id });
  } catch (error) {
    console.error("Approve staff error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.delete("/reject/:pendingUserId", authenticate, authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const pendingUser = await prisma.pendingUser.findUnique({ where: { id: req.params.pendingUserId } });
    if (!pendingUser || pendingUser.organizationId !== req.user.organizationId) {
      return res.status(404).json({ success: false, message: "Pending request not found." });
    }

    if (req.user.role === "DEPT_ADMIN") {
      const scopedIds = req.user.adminScope?.departmentIds || [];
      if (scopedIds.length > 0 && pendingUser.departmentId && !scopedIds.includes(pendingUser.departmentId)) {
        return res.status(403).json({ success: false, message: "This department is outside your admin scope." });
      }
    }

    await prisma.pendingUser.delete({ where: { id: pendingUser.id } });

    await logAudit({
      organizationId: pendingUser.organizationId,
      actorId: req.user.id,
      action: "REJECT",
      entityType: "PendingUser",
      entityId: pendingUser.id,
      description: `Rejected ${pendingUser.role} request for ${pendingUser.email}`,
    });

    return res.json({ success: true, message: "Request rejected." });
  } catch (error) {
    console.error("Reject staff error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Invitations (ORG_ADMIN / DEPT_ADMIN-initiated) ──────────

router.post("/invitations", authenticate, authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const { email, role, departmentId } = req.body;
    if (!email || !role) {
      return res.status(400).json({ success: false, message: "email and role are required." });
    }
    if (!["STAFF", "DEPT_ADMIN"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invitations can only grant STAFF or DEPT_ADMIN roles." });
    }
    if (req.user.role === "DEPT_ADMIN") {
      // A DEPT_ADMIN can only invite STAFF into a department within their
      // own scope — never grant DEPT_ADMIN themselves (that stays an
      // ORG_ADMIN decision, same line PATCH /staff/:id already draws).
      if (role !== "STAFF") {
        return res.status(403).json({ success: false, message: "You can only invite STAFF members." });
      }
      if (!departmentId || !hasDepartmentAccess(req.user, departmentId)) {
        return res.status(403).json({ success: false, message: "This department is outside your admin scope." });
      }
    }

    const organization = await prisma.organization.findUnique({ where: { id: req.user.organizationId } });

    const existingMembership = await prisma.organizationMembership.findFirst({
      where: { organizationId: organization.id, user: { email } },
    });
    if (existingMembership) {
      return res.status(409).json({ success: false, message: "This email is already a member of this organization." });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: organization.id,
        departmentId: departmentId || null,
        email,
        role,
        token,
        invitedById: req.user.id,
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_MS),
      },
    });

    const acceptLink = `${process.env.FRONTEND_URL}/invitations/${token}/accept`;
    await sendInvitationEmail(email, organization.name, role, acceptLink);

    await logAudit({
      organizationId: organization.id,
      actorId: req.user.id,
      action: "INVITE",
      entityType: "Invitation",
      entityId: invitation.id,
      description: `Invited ${email} as ${role}`,
    });

    return res.status(201).json({ success: true, message: "Invitation sent.", invitationId: invitation.id });
  } catch (error) {
    console.error("Create invitation error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// Sent invitations were previously invisible until accepted — an
// ORG_ADMIN/DEPT_ADMIN had no way to see who they'd already invited, or
// whether an invite was still outstanding. Same scoping as GET
// /admin/staff/pending: DEPT_ADMIN only sees invitations into their own
// department scope.
router.get("/invitations", authenticate, authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const { role, organizationId, adminScope } = req.user;
    if (role === "DEPT_ADMIN" && !adminScope) {
      return res.status(403).json({ success: false, message: "No admin scope configured for this account." });
    }
    const scopedIds = role === "DEPT_ADMIN" ? adminScope.departmentIds || [] : [];

    const invitations = await prisma.invitation.findMany({
      where: {
        organizationId,
        ...(scopedIds.length > 0 && { departmentId: { in: scopedIds } }),
      },
      include: {
        invitedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ success: true, data: invitations });
  } catch (error) {
    console.error("List invitations error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/invitations/:id/revoke", authenticate, authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const invitation = await prisma.invitation.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!invitation) return res.status(404).json({ success: false, message: "Invitation not found." });
    if (invitation.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "Only a pending invitation can be revoked." });
    }
    if (req.user.role === "DEPT_ADMIN" && !hasDepartmentAccess(req.user, invitation.departmentId)) {
      return res.status(403).json({ success: false, message: "This invitation is outside your admin scope." });
    }

    const updated = await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED" },
    });

    await logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      action: "REVOKE",
      entityType: "Invitation",
      entityId: invitation.id,
      description: `Revoked invitation to ${invitation.email}`,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Revoke invitation error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/invitations/:token/accept", async (req, res) => {
  try {
    const { token } = req.params;
    const { password, fullName } = req.body;

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: { organization: { select: { name: true, slug: true } } },
    });
    if (!invitation || invitation.status !== "PENDING") {
      return res.status(404).json({ success: false, message: "Invitation not found or already used." });
    }
    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
      return res.status(400).json({ success: false, message: "This invitation has expired." });
    }

    let user = await prisma.user.findUnique({ where: { email: invitation.email } });

    if (!user) {
      if (!password || !fullName) {
        return res.status(400).json({
          success: false,
          message: "fullName and password are required to accept this invitation.",
        });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: { email: invitation.email, fullName, password: hashedPassword },
      });
    }

    const existingMembership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } },
    });
    if (existingMembership) {
      return res.status(409).json({ success: false, message: "You are already a member of this organization." });
    }

    const membership = await prisma.organizationMembership.create({
      data: {
        userId: user.id,
        organizationId: invitation.organizationId,
        departmentId: invitation.departmentId,
        role: invitation.role,
        isApproved: true, // invitation is pre-vetted by the inviter
        status: "ACTIVE",
      },
    });

    // A DEPT_ADMIN with no AdminScope row fails closed everywhere
    // (GET /admin/dashboard and friends deliberately treat a missing scope
    // as "not configured", not "unrestricted" — see middleware/authenticate.js)
    // — so one has to exist the moment the membership does, not whenever an
    // ORG_ADMIN happens to remember to set it. Scope to the department the
    // invitation named, if any; an org-wide invite (no department) becomes
    // an org-wide DEPT_ADMIN (empty departmentIds), which is exactly what
    // sending that invitation without picking a department meant.
    if (invitation.role === "DEPT_ADMIN") {
      await prisma.adminScope.create({
        data: {
          membershipId: membership.id,
          departmentIds: invitation.departmentId ? [invitation.departmentId] : [],
        },
      });
    }

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    const jwtToken = signToken({
      userId: user.id,
      organizationId: membership.organizationId,
      membershipId: membership.id,
    });

    return res.status(201).json({
      success: true,
      message: "Invitation accepted.",
      token: jwtToken,
      role: membership.role,
      organizationId: membership.organizationId,
      organizationName: invitation.organization.name,
      organizationSlug: invitation.organization.slug,
      userId: user.id,
      // Same shape as /login and /verify-otp — the frontend's storeSession
      // reads these directly, and without them a freshly-accepted session
      // would have no name/email until the next full page load re-fetched
      // /auth/me.
      email: user.email,
      fullName: user.fullName,
      forcePasswordReset: user.forcePasswordReset,
    });
  } catch (error) {
    console.error("Accept invitation error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Login ────────────────────────────────────────────────────

router.post("/login", async (req, res) => {
  try {
    const { email, password, organizationSlug } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "email and password are required." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      return res.status(400).json({ success: false, message: "Invalid email or password." });
    }
    if (user.status !== "ACTIVE") {
      return res.status(403).json({ success: false, message: "This account has been deactivated." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid email or password." });
    }

    if (user.isPlatformSuperadmin) {
      const token = signToken({ userId: user.id });
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return res.json({
        success: true,
        message: "Login successful.",
        token,
        role: "SUPERADMIN",
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        // A token is issued either way — the frontend routes to a
        // set-new-password screen on this flag and calls the authenticated
        // /auth/change-password endpoint, rather than the request failing
        // outright with no usable token to act on.
        forcePasswordReset: user.forcePasswordReset,
      });
    }

    const memberships = await prisma.organizationMembership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { organization: true },
    });

    if (memberships.length === 0) {
      return res.status(403).json({ success: false, message: "This account has no active organization membership." });
    }

    let membership;
    if (organizationSlug) {
      membership = memberships.find((m) => m.organization.slug === organizationSlug);
      if (!membership) {
        return res.status(404).json({ success: false, message: "You are not a member of this organization." });
      }
    } else if (memberships.length === 1) {
      membership = memberships[0];
    } else {
      return res.status(300).json({
        success: false,
        message: "Multiple organizations found for this account. Specify organizationSlug.",
        organizations: memberships.map((m) => ({ slug: m.organization.slug, name: m.organization.name })),
      });
    }

    if (!membership.isApproved) {
      return res.status(403).json({ success: false, message: "Your account is pending approval." });
    }

    const token = signToken({
      userId: user.id,
      organizationId: membership.organizationId,
      membershipId: membership.id,
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit({
      organizationId: membership.organizationId,
      actorId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      role: membership.role,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      organizationSlug: membership.organization.slug,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      // See the SUPERADMIN branch above for why this is a flag on a
      // successful response rather than a 403 with no token.
      forcePasswordReset: user.forcePasswordReset,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Server error, try again later." });
  }
});

router.get("/verify-token", authenticate, (req, res) => {
  return res.json({ success: true, user: req.user });
});

// ── Forgot / reset password (account-level, org-independent) ──

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "email is required." });

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const resetToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "10m" });
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS) },
      });

      const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
      await sendPasswordResetEmail(email, resetLink);
    }

    // Same response whether or not the account exists, to avoid leaking
    // which emails are registered.
    return res.json({ success: true, message: "If an account exists for this email, a reset link has been sent." });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Error sending reset email." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) {
      return res.status(400).json({ success: false, message: "email, token, and newPassword are required." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.resetToken !== token || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return res.status(400).json({ success: false, message: "Token is invalid or expired." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        forcePasswordReset: false,
      },
    });

    return res.json({ success: true, message: "Password reset successful." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Error resetting password." });
  }
});

// Authenticated password change. Two callers: the forced-reset flow (a new
// ORG_ADMIN or approved STAFF logging in with a temp password for the first
// time — see forcePasswordReset on User) and, later, Settings for a normal
// voluntary password change. Both just need to prove they know the current
// password; unlike /reset-password there's no emailed token involved.
router.post("/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "currentPassword and newPassword are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "newPassword must be at least 8 characters." });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.password) {
      return res.status(400).json({ success: false, message: "This account has no password set." });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Current password is incorrect." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, forcePasswordReset: false },
    });

    return res.json({ success: true, message: "Password updated." });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: "Error updating password." });
  }
});

// ── Self-service profile (Settings page) ───────────────────────
// Deliberately narrow: email is the login identity (not editable here,
// would need re-verification) and memberId/position are org-internal
// reference fields an admin assigns via /admin/staff, not self-service.
// fullName is the only field a person can change about themselves.

router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        isPlatformSuperadmin: true,
        forcePasswordReset: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (req.user.isPlatformSuperadmin) {
      return res.json({ success: true, data: { ...user, role: "SUPERADMIN" } });
    }

    const membership = await prisma.organizationMembership.findUnique({
      where: { id: req.user.membershipId },
      select: {
        role: true,
        memberId: true,
        position: true,
        organization: { select: { id: true, name: true, slug: true } },
        department: { select: { id: true, name: true } },
      },
    });

    return res.json({
      success: true,
      data: {
        ...user,
        role: membership?.role || req.user.role,
        memberId: membership?.memberId || null,
        position: membership?.position || null,
        organization: membership?.organization || null,
        department: membership?.department || null,
      },
    });
  } catch (error) {
    console.error("Fetch profile error:", error);
    return res.status(500).json({ success: false, message: "Error fetching profile." });
  }
});

router.patch("/me", authenticate, async (req, res) => {
  try {
    const { fullName } = req.body;
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ success: false, message: "fullName is required." });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { fullName: fullName.trim() },
      select: { id: true, email: true, fullName: true },
    });

    return res.json({ success: true, message: "Profile updated.", data: user });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ success: false, message: "Error updating profile." });
  }
});

module.exports = router;
