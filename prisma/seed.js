// prisma/seed.js
//
// Bootstraps only what genuinely cannot be created any other way:
// the platform SUPERADMIN account (nothing self-registers into that role —
// see RESOBRIDGE ARCHITECTURE.md) and a small default Plan catalog.
//
// Deliberately does NOT seed a demo organization/department/complaint set.
// Hardcoding one would reintroduce industry-specific assumptions into a
// platform whose whole point is to have none — real organizations come from
// POST /api/v2/admin/organizations (SUPERADMIN-created) or self-registration.
//
// Idempotent: safe to run against a database that already has data.

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma = require("./client");

async function seedSuperadmin() {
  const email = process.env.SEED_SUPERADMIN_EMAIL || "superadmin@resobridge.app";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.isPlatformSuperadmin) {
      console.warn(`A user already exists at ${email} but is not isPlatformSuperadmin — skipping, not overwriting.`);
    } else {
      console.log(`SUPERADMIN ${email} already exists, skipping.`);
    }
    return;
  }

  const password = process.env.SEED_SUPERADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      email,
      fullName: "Platform Superadmin",
      password: hashedPassword,
      isPlatformSuperadmin: true,
      forcePasswordReset: true,
    },
  });

  console.log(`Created SUPERADMIN ${email}.`);
  if (!process.env.SEED_SUPERADMIN_PASSWORD) {
    console.log(`Generated password (shown once, forced to reset on first login): ${password}`);
  }
}

async function seedPlans() {
  const plans = [
    { name: "Starter", billingInterval: "MONTHLY", priceCents: 0, maxUsers: 25, maxDepartments: 3 },
    { name: "Growth", billingInterval: "MONTHLY", priceCents: 9900, maxUsers: 200, maxDepartments: 20 },
    { name: "Scale", billingInterval: "MONTHLY", priceCents: 29900, maxUsers: null, maxDepartments: null },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: {},
      create: plan,
    });
  }
  console.log(`Ensured ${plans.length} plans exist (Starter, Growth, Scale).`);
}

async function main() {
  await seedSuperadmin();
  await seedPlans();
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
