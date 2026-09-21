// prisma/seedDemoData.js
//
// Usage: node prisma/seedDemoData.js <organization-slug>
//
// Development-only content seeder, deliberately separate from seed.js
// (which is the production bootstrap — SUPERADMIN + plan catalog only).
// This populates realistic supporting data for ONE EXISTING organization
// so its dashboards, analytics, reports, and notifications have something
// real to show, instead of that only being visible after hand-creating
// dozens of requests through the UI one at a time.
//
// Deliberately does NOT create any accounts or credentials. It reuses
// whichever ORG_ADMIN/DEPT_ADMIN/STAFF/REQUESTER memberships already exist
// in the target org (created through the real registration/invitation
// flows this app actually ships). If a role doesn't exist yet in the org,
// whatever this script would have used it for is just skipped or
// attributed to a role that does exist — it never fabricates a user to
// route data at. Safe to re-run: departments/categories are upserted, and
// sample requests are only created if none exist yet for that department
// (checked via a fixed title prefix, see SAMPLE_TITLE_PREFIX).

const prisma = require("./client");

const SAMPLE_TITLE_PREFIX = "[demo]";

const DEPARTMENT_SPECS = [
  {
    name: "Facilities",
    code: "FAC",
    type: "Maintenance",
    categories: [
      { name: "Plumbing", slaHours: 48 },
      { name: "Electrical", slaHours: 24 },
      { name: "Cleaning", slaHours: 72 },
    ],
  },
  {
    name: "IT Support",
    code: "IT",
    type: "Technology",
    categories: [
      { name: "Hardware", slaHours: 24 },
      { name: "Software", slaHours: 48 },
      { name: "Network", slaHours: 12 },
    ],
  },
];

async function notify({ organizationId, userId, type, title, message, entityId }) {
  await prisma.notification.create({
    data: { organizationId, userId, type, title, message, entityType: "Complaint", entityId },
  });
}

async function ensureDepartments(organization) {
  const results = [];
  for (const spec of DEPARTMENT_SPECS) {
    const department = await prisma.department.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: spec.code } },
      update: {},
      create: { organizationId: organization.id, name: spec.name, code: spec.code, type: spec.type },
    });

    const categories = [];
    for (const cat of spec.categories) {
      const category = await prisma.departmentCategory.upsert({
        where: { departmentId_name: { departmentId: department.id, name: cat.name } },
        update: {},
        create: {
          organizationId: organization.id,
          departmentId: department.id,
          name: cat.name,
          slaHours: cat.slaHours,
        },
      });
      categories.push(category);
    }
    results.push({ department, categories });
  }
  return results;
}

async function ensureInfrastructure(organization, department) {
  const existing = await prisma.building.findFirst({ where: { departmentId: department.id } });
  if (existing) {
    return prisma.area.findFirst({ where: { buildingId: existing.id } });
  }

  const building = await prisma.building.create({
    data: {
      organizationId: organization.id,
      departmentId: department.id,
      name: `${department.name} Building`,
      type: "Office",
    },
  });

  const groundFloor = await prisma.area.create({
    data: {
      organizationId: organization.id,
      buildingId: building.id,
      name: "Ground Floor",
      type: "Floor",
      locationType: "INTERIOR",
    },
  });

  await prisma.area.create({
    data: {
      organizationId: organization.id,
      buildingId: building.id,
      name: "First Floor",
      type: "Floor",
      locationType: "INTERIOR",
    },
  });

  return groundFloor;
}

// Creates one sample request plus whatever event/notification trail is
// consistent with the real API for the target end state — a demo request
// left with a bare status and no history would look fake next to
// everything the actual app produces.
async function createSampleRequest({ organization, department, category, area, submitter, staff, orgAdmin, target }) {
  const created = await prisma.$transaction(async (tx) => {
    const complaint = await tx.complaint.create({
      data: {
        organizationId: organization.id,
        departmentId: department.id,
        categoryId: category.id,
        areaId: area?.id || null,
        memberId: submitter.userId,
        title: `${SAMPLE_TITLE_PREFIX} ${target.title}`,
        description: target.description,
        priority: target.priority || "MEDIUM",
      },
    });
    await tx.complaintEvent.create({
      data: { complaintId: complaint.id, organizationId: organization.id, type: "CREATED", actorId: submitter.userId },
    });
    return complaint;
  });

  await notify({
    organizationId: organization.id,
    userId: orgAdmin.userId,
    type: "COMPLAINT_SUBMITTED",
    title: "New request submitted",
    message: `${created.title} (${category.name})`,
    entityId: created.id,
  });

  if (target.stage === "PENDING") return created;

  // ASSIGNED
  let complaint = created;
  if (staff) {
    complaint = await prisma.$transaction(async (tx) => {
      const updated = await tx.complaint.update({
        where: { id: complaint.id },
        data: { assignedStaffId: staff.userId, status: "IN_PROGRESS" },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: organization.id,
          type: "ASSIGNED",
          toValue: staff.userId,
          actorId: orgAdmin.userId,
        },
      });
      return updated;
    });
    await notify({
      organizationId: organization.id,
      userId: staff.userId,
      type: "COMPLAINT_ASSIGNED",
      title: "Request assigned to you",
      message: complaint.title,
      entityId: complaint.id,
    });
  }
  if (target.stage === "IN_PROGRESS") return complaint;

  // AWAITING_CONFIRMATION
  complaint = await prisma.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id: complaint.id },
      data: { status: "AWAITING_CONFIRMATION" },
    });
    await tx.complaintEvent.create({
      data: {
        complaintId: complaint.id,
        organizationId: organization.id,
        type: "STATUS_CHANGED",
        fromValue: "IN_PROGRESS",
        toValue: "AWAITING_CONFIRMATION",
        actorId: staff?.userId || orgAdmin.userId,
      },
    });
    return updated;
  });
  await notify({
    organizationId: organization.id,
    userId: submitter.userId,
    type: "COMPLAINT_STATUS_CHANGED",
    title: "Your request status changed",
    message: `${complaint.title}: AWAITING_CONFIRMATION`,
    entityId: complaint.id,
  });
  if (target.stage === "AWAITING_CONFIRMATION") return complaint;

  if (target.stage === "DISPUTED") {
    complaint = await prisma.$transaction(async (tx) => {
      const updated = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: "IN_PROGRESS",
          disputeReason: target.disputeReason,
          disputedAt: new Date(),
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          organizationId: organization.id,
          type: "DISPUTED",
          actorId: submitter.userId,
          note: target.disputeReason,
        },
      });
      return updated;
    });
    if (staff) {
      await notify({
        organizationId: organization.id,
        userId: staff.userId,
        type: "COMPLAINT_DISPUTED",
        title: "Request resolution disputed",
        message: `${complaint.title}: ${target.disputeReason}`,
        entityId: complaint.id,
      });
    }
    return complaint;
  }

  // RESOLVED (via confirm)
  complaint = await prisma.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id: complaint.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    await tx.complaintEvent.create({
      data: { complaintId: complaint.id, organizationId: organization.id, type: "CONFIRMED", actorId: submitter.userId },
    });
    return updated;
  });
  await notify({
    organizationId: organization.id,
    userId: submitter.userId,
    type: "COMPLAINT_RESOLVED",
    title: "Your request status changed",
    message: `${complaint.title}: RESOLVED`,
    entityId: complaint.id,
  });
  if (target.stage === "RESOLVED") return complaint;

  // REOPENED (the ORG_ADMIN-only action)
  complaint = await prisma.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id: complaint.id },
      data: { status: "IN_PROGRESS", resolvedAt: null },
    });
    await tx.complaintEvent.create({
      data: {
        complaintId: complaint.id,
        organizationId: organization.id,
        type: "REOPENED",
        fromValue: "RESOLVED",
        toValue: "IN_PROGRESS",
        actorId: orgAdmin.userId,
        note: target.reopenReason,
      },
    });
    return updated;
  });
  const reopenRecipients = [submitter.userId, staff?.userId].filter((id, i, all) => id && all.indexOf(id) === i);
  await Promise.all(
    reopenRecipients.map((userId) =>
      notify({
        organizationId: organization.id,
        userId,
        type: "COMPLAINT_STATUS_CHANGED",
        title: "Request reopened",
        message: `${complaint.title}: ${target.reopenReason}`,
        entityId: complaint.id,
      }),
    ),
  );
  return complaint;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node prisma/seedDemoData.js <organization-slug>");
    process.exit(1);
  }

  const organization = await prisma.organization.findUnique({ where: { slug } });
  if (!organization) {
    console.error(`No organization found with slug "${slug}".`);
    process.exit(1);
  }

  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId: organization.id, status: "ACTIVE", isApproved: true },
  });

  const orgAdmin = memberships.find((m) => m.role === "ORG_ADMIN");
  if (!orgAdmin) {
    console.error(`"${organization.name}" has no active ORG_ADMIN yet — nothing to attribute this data to.`);
    process.exit(1);
  }
  const requesters = memberships.filter((m) => m.role === "REQUESTER");
  const submitterPool = requesters.length > 0 ? requesters : [orgAdmin];

  console.log(`Seeding demo data for "${organization.name}" (${slug})...`);

  const departments = await ensureDepartments(organization);
  console.log(`Ensured ${departments.length} departments with categories.`);

  const existingSample = await prisma.complaint.findFirst({
    where: { organizationId: organization.id, title: { startsWith: SAMPLE_TITLE_PREFIX } },
  });
  if (existingSample) {
    console.log("Sample requests already exist for this org (found a [demo] request) — skipping request creation.");
    console.log("Delete rows with a title starting with '[demo]' first if you want a fresh batch.");
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const { department, categories } of departments) {
    const area = await ensureInfrastructure(organization, department);
    const staffHere = memberships.find((m) => m.role === "STAFF" && m.departmentId === department.id);
    const category = categories[0];

    const stages = [
      { stage: "PENDING", title: `${category.name} issue just reported`, description: "Freshly submitted, not yet picked up." },
      { stage: "IN_PROGRESS", title: `${category.name} issue being worked on`, description: "Assigned and in progress." },
      {
        stage: "AWAITING_CONFIRMATION",
        title: `${category.name} issue marked fixed`,
        description: "Resolver says it's done, awaiting confirmation.",
      },
      { stage: "RESOLVED", title: `${category.name} issue resolved`, description: "Confirmed fixed by the requester." },
      {
        stage: "DISPUTED",
        title: `${category.name} issue disputed`,
        description: "Requester said the fix didn't actually work.",
        disputeReason: "Still broken after the reported fix.",
      },
      {
        stage: "REOPENED",
        title: `${category.name} issue reopened`,
        description: "Resolved, then reopened after a follow-up complaint.",
        reopenReason: "Requester reported the same issue recurring.",
      },
    ];

    for (let i = 0; i < stages.length; i += 1) {
      const submitter = submitterPool[i % submitterPool.length];
      await createSampleRequest({
        organization,
        department,
        category,
        area,
        submitter,
        staff: staffHere,
        orgAdmin,
        target: stages[i],
      });
      created += 1;
    }
  }

  console.log(`Created ${created} sample requests (spread across pending/in-progress/awaiting-confirmation/resolved/disputed/reopened), with matching history and notifications.`);
  if (!memberships.some((m) => m.role === "STAFF")) {
    console.log("No STAFF found in this org yet, so nothing got assigned — invite one to see the assigned-to-me queue populated.");
  }
  if (!memberships.some((m) => m.role === "DEPT_ADMIN")) {
    console.log("No DEPT_ADMIN found in this org yet — invite one to test department-scoped views against this data.");
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Demo seed failed:", error);
  prisma.$disconnect().finally(() => process.exit(1));
});
