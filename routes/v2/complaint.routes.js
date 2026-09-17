// routes/v2/complaint.routes.js
//
// Submit, track, assign, update status, confirm, dispute, comment, attach.
//
// Per TARGET.md: submitting and tracking a complaint is a baseline
// capability every authenticated organisation role has (REQUESTER, STAFF,
// DEPT_ADMIN, ORG_ADMIN) — not a role-exclusive action. Two access rules
// follow from that, and are deliberately kept separate (see
// canViewComplaint / canOperateOnComplaint below):
//   - Viewing/commenting/confirming/disputing a complaint: allowed if you
//     submitted it yourself, OR you have operational department scope
//     over it. Being the submitter never requires scope.
//   - Operating on a complaint (assign/status/escalate): requires
//     department scope, full stop. Being the submitter of your own
//     complaint never grants yourself operational rights over it — a
//     DEPT_ADMIN can't use "I filed this ticket" to bypass their own
//     department scoping.
//
// Status transitions (see ALLOWED_TRANSITIONS): STAFF can only move a
// complaint they're assigned to along the legal path
// PENDING -> IN_PROGRESS -> AWAITING_CONFIRMATION. RESOLVED is only ever
// reached by the submitter confirming (PUT /confirm) or a DEPT_ADMIN/
// ORG_ADMIN override. DEPT_ADMIN/ORG_ADMIN can force any transition —
// that's a deliberate override valve, not an oversight.
//
// Dispute is not a status (see prisma/schema.prisma's ComplaintStatus
// comment) — PUT /dispute reopens to IN_PROGRESS and records the dispute on
// the complaint plus a DISPUTED ComplaintEvent for the timeline. Per
// TARGET.md, RESOLVED is closed for the MVP: dispute is only available
// while AWAITING_CONFIRMATION, not after confirmation.

const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");
const { authenticate, authorizeRoles, hasDepartmentAccess } = require("../../middleware/authenticate");
const { sendComplaintReceiptEmail, sendComplaintAssignmentEmail } = require("../../utils/sendEmail");

router.use(authenticate);

const ALLOWED_TRANSITIONS = {
  PENDING: ["IN_PROGRESS"],
  IN_PROGRESS: ["AWAITING_CONFIRMATION"],
  AWAITING_CONFIRMATION: ["RESOLVED", "IN_PROGRESS"],
  RESOLVED: [],
};

// View access: the submitter always has access to their own complaint
// (baseline capability, held by every role); everyone else needs
// departmental resolve/manage scope.
function canViewComplaint(reqUser, complaint) {
  if (complaint.memberId === reqUser.id) return true;
  return hasDepartmentAccess(reqUser, complaint.departmentId);
}

// Operational access (assign/status/escalate): department scope only.
// Submitting a complaint never grants operational rights over it, even to
// a DEPT_ADMIN/STAFF account whose own department scope wouldn't
// otherwise cover it.
function canOperateOnComplaint(reqUser, complaint) {
  return hasDepartmentAccess(reqUser, complaint.departmentId);
}

async function findComplaintForUser(req, complaintId, { include, requireScope = false } = {}) {
  const complaint = await prisma.complaint.findFirst({
    where: { id: complaintId, organizationId: req.user.organizationId },
    ...(include && { include }),
  });
  if (!complaint) return null;
  const hasAccess = requireScope ? canOperateOnComplaint(req.user, complaint) : canViewComplaint(req.user, complaint);
  if (!hasAccess) return null;
  return complaint;
}

async function notify({ organizationId, userId, type, title, message, entityId }) {
  try {
    await prisma.notification.create({
      data: { organizationId, userId, type, title, message, entityType: "Complaint", entityId },
    });
  } catch (err) {
    console.error("Notification write failed:", err);
  }
}

// ── Submit ───────────────────────────────────────────────────
// Baseline capability for every organisation role — SUPERADMIN excluded
// explicitly since it has no organisation membership to submit as.

router.post("/", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN", "STAFF", "REQUESTER"), async (req, res) => {
  try {
    const { categoryId, title, description, location, areaId, assetId } = req.body;
    if (!categoryId || !title || !description) {
      return res.status(400).json({ success: false, message: "categoryId, title, and description are required." });
    }

    const category = await prisma.departmentCategory.findFirst({
      where: { id: categoryId, organizationId: req.user.organizationId, status: "ACTIVE" },
    });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }

    let area = null;
    if (areaId) {
      area = await prisma.area.findFirst({
        where: { id: areaId, organizationId: req.user.organizationId },
        include: { building: true },
      });
      if (!area) return res.status(404).json({ success: false, message: "Area not found." });
      if (area.building.departmentId !== category.departmentId) {
        return res.status(400).json({ success: false, message: "This area does not belong to the category's department." });
      }
    }

    if (assetId) {
      const asset = await prisma.asset.findFirst({
        where: { id: assetId, organizationId: req.user.organizationId },
      });
      if (!asset) return res.status(404).json({ success: false, message: "Asset not found." });
      if (areaId && asset.areaId !== areaId) {
        return res.status(400).json({ success: false, message: "This asset does not belong to the given area." });
      }
    }

    const dueAt = category.slaHours ? new Date(Date.now() + category.slaHours * 60 * 60 * 1000) : null;

    const complaint = await prisma.$transaction(async (tx) => {
      const created = await tx.complaint.create({
        data: {
          organizationId: req.user.organizationId,
          departmentId: category.departmentId,
          categoryId,
          areaId: areaId || null,
          assetId: assetId || null,
          memberId: req.user.id,
          title,
          description,
          location,
          dueAt,
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: created.id,
          organizationId: req.user.organizationId,
          type: "CREATED",
          actorId: req.user.id,
        },
      });
      await tx.department.update({
        where: { id: category.departmentId },
        data: { complaintsSinceRun: { increment: 1 } },
      });
      return created;
    });

    try {
      await sendComplaintReceiptEmail(req.user.email, complaint.title, complaint.id);
    } catch (err) {
      console.error("Complaint receipt email failed:", err);
    }

    try {
      const recipients = await prisma.organizationMembership.findMany({
        where: {
          organizationId: req.user.organizationId,
          userId: { not: req.user.id }, // don't notify submitters of their own submission
          OR: [
            { role: "ORG_ADMIN" },
            { role: "DEPT_ADMIN", adminScope: { departmentIds: { isEmpty: true } } },
            { role: "DEPT_ADMIN", adminScope: { departmentIds: { has: category.departmentId } } },
          ],
        },
      });
      await Promise.all(
        recipients.map((m) =>
          notify({
            organizationId: req.user.organizationId,
            userId: m.userId,
            type: "COMPLAINT_SUBMITTED",
            title: "New request submitted",
            message: `${title} (${category.name})`,
            entityId: complaint.id,
          })
        )
      );
    } catch (err) {
      console.error("Failed to notify admins of new complaint:", err);
    }

    return res.status(201).json({ success: true, data: complaint });
  } catch (error) {
    console.error("Submit complaint error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong submitting the request." });
  }
});

// ── List / detail ────────────────────────────────────────────
// ?mine=true is the "My Requests" surface (TARGET.md): every role can ask
// for just what they personally submitted, overriding their normal
// work/management scope below. REQUESTER always gets this regardless of
// the flag — they have no broader scope to fall back to.

router.get("/", async (req, res) => {
  try {
    const { role, id: userId, organizationId, departmentId: userDepartmentId, adminScope } = req.user;
    const { status, areaId, categoryId, assignedStaffId, priority, departmentId, mine } = req.query;

    const where = { organizationId };

    if (mine === "true" || role === "REQUESTER") {
      where.memberId = userId;
    } else if (role === "STAFF") {
      where.departmentId = userDepartmentId;
    } else if (role === "DEPT_ADMIN") {
      if (!adminScope) {
        return res.status(403).json({ success: false, message: "No admin scope configured for this account." });
      }
      const scopedIds = adminScope.departmentIds || [];
      if (scopedIds.length > 0) {
        where.departmentId = departmentId && scopedIds.includes(departmentId) ? departmentId : { in: scopedIds };
      } else if (departmentId) {
        where.departmentId = departmentId;
      }
    } else if (role === "ORG_ADMIN" && departmentId) {
      where.departmentId = departmentId;
    }

    if (status) where.status = status;
    if (areaId) where.areaId = areaId;
    if (categoryId) where.categoryId = categoryId;
    if (assignedStaffId) where.assignedStaffId = assignedStaffId;
    if (priority) where.priority = priority;

    const complaints = await prisma.complaint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { category: true, area: true, asset: true },
    });

    return res.json({ success: true, data: complaints });
  } catch (error) {
    console.error("List complaints error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/:complaintId", async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId, {
      include: {
        category: true,
        area: true,
        asset: true,
        member: { select: { id: true, fullName: true, email: true } },
        assignedStaff: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });
    return res.json({ success: true, data: complaint });
  } catch (error) {
    console.error("Get complaint error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Assignment ───────────────────────────────────────────────

router.patch("/:complaintId/assign", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId, { requireScope: true });
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });

    const { assignedStaffId } = req.body;
    if (!assignedStaffId) {
      return res.status(400).json({ success: false, message: "assignedStaffId is required." });
    }

    const staffMembership = await prisma.organizationMembership.findFirst({
      where: {
        userId: assignedStaffId,
        organizationId: req.user.organizationId,
        role: "STAFF",
        departmentId: complaint.departmentId,
        status: "ACTIVE",
      },
    });
    if (!staffMembership) {
      return res.status(400).json({ success: false, message: "assignedStaffId must be an active staff member of this request's department." });
    }

    const previousStaffId = complaint.assignedStaffId;
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          assignedStaffId,
          ...(complaint.status === "PENDING" && { status: "IN_PROGRESS" }),
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          type: previousStaffId ? "REASSIGNED" : "ASSIGNED",
          fromValue: previousStaffId,
          toValue: assignedStaffId,
          actorId: req.user.id,
        },
      });
      return result;
    });

    await notify({
      organizationId: req.user.organizationId,
      userId: assignedStaffId,
      type: "COMPLAINT_ASSIGNED",
      title: "Request assigned to you",
      message: complaint.title,
      entityId: complaint.id,
    });

    try {
      const staffUser = await prisma.user.findUnique({ where: { id: assignedStaffId } });
      const department = await prisma.department.findUnique({ where: { id: complaint.departmentId } });
      if (staffUser) {
        await sendComplaintAssignmentEmail(
          staffUser.email,
          department?.name || "your department",
          complaint.id,
          complaint.title,
          complaint.description,
          complaint.location
        );
      }
    } catch (err) {
      console.error("Assignment email failed:", err);
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Assign complaint error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Status ───────────────────────────────────────────────────

router.patch("/:complaintId/status", authorizeRoles("STAFF", "DEPT_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId, { requireScope: true });
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });

    const { status, note } = req.body;
    if (!status) return res.status(400).json({ success: false, message: "status is required." });

    if (req.user.role === "STAFF") {
      if (complaint.assignedStaffId !== req.user.id) {
        return res.status(403).json({ success: false, message: "You are not assigned to this request." });
      }
      if (!["IN_PROGRESS", "AWAITING_CONFIRMATION"].includes(status)) {
        return res.status(403).json({ success: false, message: "Staff may only move a request to IN_PROGRESS or AWAITING_CONFIRMATION." });
      }
      if (!ALLOWED_TRANSITIONS[complaint.status]?.includes(status)) {
        return res.status(400).json({ success: false, message: `Cannot move from ${complaint.status} to ${status}.` });
      }
    }
    // DEPT_ADMIN / ORG_ADMIN: override valve, no transition-table restriction.

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status,
          ...(status === "RESOLVED" && { resolvedAt: new Date() }),
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          type: "STATUS_CHANGED",
          fromValue: complaint.status,
          toValue: status,
          actorId: req.user.id,
          note,
        },
      });
      return result;
    });

    await notify({
      organizationId: req.user.organizationId,
      userId: complaint.memberId,
      type: status === "RESOLVED" ? "COMPLAINT_RESOLVED" : "COMPLAINT_STATUS_CHANGED",
      title: "Your request status has changed",
      message: `${complaint.title}: ${status}`,
      entityId: complaint.id,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update complaint status error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Escalate ─────────────────────────────────────────────────

router.patch("/:complaintId/escalate", authorizeRoles("ORG_ADMIN", "DEPT_ADMIN"), async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId, { requireScope: true });
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });

    const { note } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.complaint.update({
        where: { id: complaint.id },
        data: { escalated: true, escalatedAt: new Date() },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          type: "ESCALATED",
          actorId: req.user.id,
          note,
        },
      });
      return result;
    });

    try {
      const admins = await prisma.organizationMembership.findMany({
        where: { organizationId: req.user.organizationId, role: "ORG_ADMIN" },
      });
      await Promise.all(
        admins.map((m) =>
          notify({
            organizationId: req.user.organizationId,
            userId: m.userId,
            type: "COMPLAINT_ESCALATED",
            title: "Request escalated",
            message: complaint.title,
            entityId: complaint.id,
          })
        )
      );
    } catch (err) {
      console.error("Escalation notification failed:", err);
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Escalate complaint error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Submitter confirm / dispute ─────────────────────────────
// Any role can submit a complaint (see module comment), so these gate on
// being the complaint's submitter, not on role — authenticate() alone
// admits any authenticated org role here; the ownership check below is
// the real gate.

router.put("/:complaintId/confirm", async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId);
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });
    if (complaint.memberId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Only the person who submitted this request can confirm it." });
    }
    if (complaint.status !== "AWAITING_CONFIRMATION") {
      return res.status(400).json({ success: false, message: "Request is not awaiting confirmation." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.complaint.update({
        where: { id: complaint.id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          type: "CONFIRMED",
          actorId: req.user.id,
        },
      });
      return result;
    });

    return res.json({ success: true, message: "Request confirmed as resolved.", data: updated });
  } catch (error) {
    console.error("Confirm complaint error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.put("/:complaintId/dispute", async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId);
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });
    if (complaint.memberId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Only the person who submitted this request can dispute it." });
    }
    if (complaint.status !== "AWAITING_CONFIRMATION") {
      return res.status(400).json({ success: false, message: "Request is not awaiting confirmation." });
    }

    const { reason, evidence } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: "A reason is required to dispute a request." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: "IN_PROGRESS",
          disputeReason: reason.trim(),
          disputeEvidence: evidence || null,
          disputedAt: new Date(),
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          type: "DISPUTED",
          actorId: req.user.id,
          note: reason.trim(),
        },
      });
      return result;
    });

    if (complaint.assignedStaffId) {
      await notify({
        organizationId: req.user.organizationId,
        userId: complaint.assignedStaffId,
        type: "COMPLAINT_DISPUTED",
        title: "Request resolution disputed",
        message: `${complaint.title}: ${reason.trim()}`,
        entityId: complaint.id,
      });
    }

    return res.json({ success: true, message: "Request disputed.", data: updated });
  } catch (error) {
    console.error("Dispute complaint error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Comments ─────────────────────────────────────────────────
// Internal-comment visibility follows operational scope over this
// complaint's department, not role — someone viewing purely as the
// submitter (no department scope) never sees internal notes, even if
// their role elsewhere is STAFF/DEPT_ADMIN/ORG_ADMIN. Someone with real
// scope over the department sees everything, including on their own
// submitted complaint.

router.get("/:complaintId/comments", async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId);
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });

    const comments = await prisma.complaintComment.findMany({
      where: {
        complaintId: complaint.id,
        ...(!hasDepartmentAccess(req.user, complaint.departmentId) && { isInternal: false }),
      },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, fullName: true } } },
    });
    return res.json({ success: true, data: comments });
  } catch (error) {
    console.error("List comments error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/:complaintId/comments", async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId);
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });

    const { body } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ success: false, message: "body is required." });
    }
    const isInternal = hasDepartmentAccess(req.user, complaint.departmentId) && req.body.isInternal === true;

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.complaintComment.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          authorId: req.user.id,
          body: body.trim(),
          isInternal,
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          type: "COMMENT_ADDED",
          actorId: req.user.id,
        },
      });
      return created;
    });

    return res.status(201).json({ success: true, data: comment });
  } catch (error) {
    console.error("Create comment error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Attachments ──────────────────────────────────────────────

router.post("/:complaintId/attachments", async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId);
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });

    const { url, fileType, sizeBytes } = req.body;
    if (!url) return res.status(400).json({ success: false, message: "url is required." });

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.complaintAttachment.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          uploadedById: req.user.id,
          url,
          fileType,
          sizeBytes,
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: req.user.organizationId,
          type: "ATTACHMENT_ADDED",
          actorId: req.user.id,
        },
      });
      return created;
    });

    return res.status(201).json({ success: true, data: attachment });
  } catch (error) {
    console.error("Create attachment error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Timeline ─────────────────────────────────────────────────

router.get("/:complaintId/events", async (req, res) => {
  try {
    const complaint = await findComplaintForUser(req, req.params.complaintId);
    if (!complaint) return res.status(404).json({ success: false, message: "Request not found." });

    const events = await prisma.complaintEvent.findMany({
      where: { complaintId: complaint.id },
      orderBy: { createdAt: "asc" },
      include: { actor: { select: { id: true, fullName: true } } },
    });
    return res.json({ success: true, data: events });
  } catch (error) {
    console.error("List complaint events error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
