-- Hand-authored migration (not raw `prisma migrate diff` output).
-- The auto-generated diff would have added several NOT NULL columns with no
-- default to non-empty tables (fails outright) and dropped User.role /
-- departmentId / isApproved with no replacement OrganizationMembership rows
-- (silently orphans every existing account). This version backfills from the
-- live data instead. Verified beforehand: no NULLs in any backfill source
-- column, no duplicate User emails, no Complaint rows using the two
-- ComplaintStatus values being dropped (DISPUTED/EXPIRED), exactly one
-- Organization row.

BEGIN;

-- ============================================================
-- 1. New enums unrelated to Role/ComplaintStatus
-- ============================================================
CREATE TYPE "OrgStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED');
CREATE TYPE "RegistrationMode" AS ENUM ('OPEN', 'INVITE_ONLY', 'DOMAIN_RESTRICTED');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "ComplaintEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'REASSIGNED', 'ESCALATED', 'COMMENT_ADDED', 'ATTACHMENT_ADDED', 'DISPUTED', 'CONFIRMED');
-- GENERAL added beyond the original design so the 80 existing Notification
-- rows (which predate the type/title concept entirely) have somewhere
-- truthful to land, instead of being deleted or given a misleading type.
CREATE TYPE "NotificationType" AS ENUM ('COMPLAINT_SUBMITTED', 'COMPLAINT_ASSIGNED', 'COMPLAINT_STATUS_CHANGED', 'COMPLAINT_RESOLVED', 'COMPLAINT_DISPUTED', 'COMPLAINT_ESCALATED', 'STAFF_INVITED', 'STAFF_APPROVED', 'ADMIN_APPROVED', 'INSIGHT_READY', 'PASSWORD_RESET', 'GENERAL');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "PendingUserStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED');
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTRATION', 'PASSWORD_RESET', 'ADMIN_CREATION');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'APPROVE', 'REJECT', 'INVITE', 'ESCALATE', 'EXPORT');

-- Temporary name: the old "Role" type is still in use by User.role until
-- step 6 drops that column, so it can't be renamed away yet.
CREATE TYPE "RoleNew" AS ENUM ('SUPERADMIN', 'ORG_ADMIN', 'ADMIN', 'STAFF', 'MEMBER');

-- ============================================================
-- 2. ComplaintStatus swap (safe: verified no row uses DISPUTED/EXPIRED)
-- ============================================================
CREATE TYPE "ComplaintStatus_new" AS ENUM ('PENDING', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'RESOLVED');
ALTER TABLE "Complaint" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Complaint" ALTER COLUMN "status" TYPE "ComplaintStatus_new" USING ("status"::text::"ComplaintStatus_new");
DROP TYPE "ComplaintStatus";
ALTER TYPE "ComplaintStatus_new" RENAME TO "ComplaintStatus";
ALTER TABLE "Complaint" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ============================================================
-- 3. New tables (User still has its old shape at this point — that's fine,
--    these only need User.id to exist for FKs, not its other columns)
-- ============================================================

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingInterval" "BillingInterval" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "maxUsers" INTEGER,
    "maxDepartments" INTEGER,
    "features" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "seats" INTEGER NOT NULL DEFAULT 5,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResourceAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "allocatedById" TEXT,
    "notes" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResourceAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "RoleNew" NOT NULL,
    "departmentId" TEXT,
    "memberId" TEXT,
    "position" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminScope" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canManageStaff" BOOLEAN NOT NULL DEFAULT false,
    "canViewAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "canEscalate" BOOLEAN NOT NULL DEFAULT false,
    "canExportReports" BOOLEAN NOT NULL DEFAULT false,
    "canManageCategories" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminScope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PendingUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "role" "RoleNew" NOT NULL,
    "position" TEXT,
    "memberId" TEXT,
    "status" "PendingUserStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "email" TEXT NOT NULL,
    "role" "RoleNew" NOT NULL,
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplaintEvent" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ComplaintEventType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplaintEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplaintComment" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplaintComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplaintAttachment" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplaintAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplaintInsight" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,
    "observations" JSONB,
    "hypotheses" JSONB,
    "anomalies" JSONB,
    "recommendations" JSONB,
    "complaintCount" INTEGER,
    CONSTRAINT "ComplaintInsight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userRole" "RoleNew" NOT NULL,
    "lastMessage" TEXT NOT NULL DEFAULT '',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "context" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 4. Backfill OrganizationMembership from existing User data.
--    STUDENT -> MEMBER, STAFF -> STAFF, DEPARTMENT_ADMIN -> ADMIN.
--    SUPERADMIN gets no membership at all (see step 5) — it becomes a
--    platform-level flag on User instead, per the new architecture.
--    Verified beforehand: single Organization row, so departmentId (when
--    present) already implies the correct org via Department.organizationId;
--    when absent (the 20 MEMBER-to-be users), fall back to the one org.
-- ============================================================
INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "departmentId", "memberId", "position", "status", "isApproved", "joinedAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  COALESCE((SELECT d."organizationId" FROM "Department" d WHERE d."id" = u."departmentId"), (SELECT o."id" FROM "Organization" o LIMIT 1)),
  CASE u."role"
    WHEN 'STUDENT' THEN 'MEMBER'
    WHEN 'STAFF' THEN 'STAFF'
    WHEN 'DEPARTMENT_ADMIN' THEN 'ADMIN'
  END::"RoleNew",
  u."departmentId",
  COALESCE(u."studentId", u."staffId"),
  u."position",
  'ACTIVE',
  u."isApproved",
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" != 'SUPERADMIN';

-- Default AdminScope for the migrated DEPARTMENT_ADMIN -> ADMIN account:
-- scoped to the one department they administered, with full permissions
-- within it (mirrors their previous authority). Adjustable afterward via
-- PATCH /api/v2/admin/staff/:membershipId/scope.
INSERT INTO "AdminScope" ("id", "membershipId", "departmentIds", "canManageStaff", "canViewAnalytics", "canEscalate", "canExportReports", "canManageCategories", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  om."id",
  CASE WHEN om."departmentId" IS NOT NULL THEN ARRAY[om."departmentId"] ELSE ARRAY[]::TEXT[] END,
  true, true, true, true, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "OrganizationMembership" om
WHERE om."role" = 'ADMIN';

-- ============================================================
-- 5. Mark the platform superadmin (isPlatformSuperadmin added in step 6)
-- ============================================================
-- (deferred to right after the column is added below)

-- ============================================================
-- 6. User table: add new columns, backfill, drop old ones
-- ============================================================
ALTER TABLE "User" ADD COLUMN "isPlatformSuperadmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "User" SET "isPlatformSuperadmin" = true WHERE "role" = 'SUPERADMIN';

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_departmentId_fkey";
DROP INDEX IF EXISTS "User_departmentId_idx";
DROP INDEX IF EXISTS "User_staffId_key";
DROP INDEX IF EXISTS "User_studentId_key";

ALTER TABLE "User"
  DROP COLUMN "departmentId",
  DROP COLUMN "isApproved",
  DROP COLUMN "position",
  DROP COLUMN "role",
  DROP COLUMN "staffId",
  DROP COLUMN "studentId";

-- Drop tables fully superseded by the new model before dropping the old
-- "Role" type — PendingStaff.role still references it.
-- PendingStaff: 0 rows. PendingStudent: 1 row, a placeholder test
-- registration ("Test Student" / youremail@gmail.com) — not a real account,
-- nothing to preserve. complaintsInsights: regenerable cache.
DROP TABLE "PendingStaff";
DROP TABLE "PendingStudent";
DROP TABLE "complaintsInsights";

-- Now nothing references the old "Role" type — replace it with "RoleNew".
DROP TYPE "Role";
ALTER TYPE "RoleNew" RENAME TO "Role";

-- ============================================================
-- 7. Building / Area / Asset / DepartmentCategory: add organizationId,
--    backfill in dependency order (Building has no dependency, Area needs
--    Building's value, Asset needs Area's value), then enforce NOT NULL.
-- ============================================================
ALTER TABLE "Building" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Building" ALTER COLUMN "type" DROP DEFAULT;
UPDATE "Building" b SET "organizationId" = d."organizationId" FROM "Department" d WHERE d."id" = b."departmentId";
ALTER TABLE "Building" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Area" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Area" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Area" a SET "organizationId" = b."organizationId" FROM "Building" b WHERE b."id" = a."buildingId";
ALTER TABLE "Area" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Asset" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Asset" ALTER COLUMN "totalCost" SET DATA TYPE DECIMAL(12,2);
ALTER TABLE "Asset" ALTER COLUMN "costOfMaintenance" SET DATA TYPE DECIMAL(12,2);
UPDATE "Asset" ast SET "organizationId" = a."organizationId" FROM "Area" a WHERE a."id" = ast."areaId";
ALTER TABLE "Asset" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "DepartmentCategory" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "DepartmentCategory" ADD COLUMN "slaHours" INTEGER;
ALTER TABLE "DepartmentCategory" ALTER COLUMN "subcategories" SET DEFAULT ARRAY[]::TEXT[];
UPDATE "DepartmentCategory" dc SET "organizationId" = d."organizationId" FROM "Department" d WHERE d."id" = dc."departmentId";
ALTER TABLE "DepartmentCategory" ALTER COLUMN "organizationId" SET NOT NULL;

-- ============================================================
-- 8. Department / Organization: additive, nullable-or-defaulted columns only
-- ============================================================
ALTER TABLE "Department" ADD COLUMN "complaintsSinceRun" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Department" ADD COLUMN "lastInsightRun" TIMESTAMP(3);
ALTER TABLE "Department" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Department" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "Organization" ADD COLUMN "allowedEmailDomain" TEXT;
ALTER TABLE "Organization" ADD COLUMN "complaintsSinceRun" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Organization" ADD COLUMN "lastInsightRun" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Organization" ADD COLUMN "primaryContactEmail" TEXT;
ALTER TABLE "Organization" ADD COLUMN "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'INVITE_ONLY';
ALTER TABLE "Organization" ADD COLUMN "status" "OrgStatus" NOT NULL DEFAULT 'TRIAL';
ALTER TABLE "Organization" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- ============================================================
-- 9. Complaint: add columns, backfill organizationId + memberId (from the
--    old required studentId, verified non-null for all 120 rows), drop old
-- ============================================================
ALTER TABLE "Complaint" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Complaint" ADD COLUMN "memberId" TEXT;
ALTER TABLE "Complaint" ADD COLUMN "disputeEvidence" TEXT;
ALTER TABLE "Complaint" ADD COLUMN "disputeReason" TEXT;
ALTER TABLE "Complaint" ADD COLUMN "disputedAt" TIMESTAMP(3);
ALTER TABLE "Complaint" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "Complaint" ADD COLUMN "escalated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Complaint" ADD COLUMN "escalatedAt" TIMESTAMP(3);
ALTER TABLE "Complaint" ADD COLUMN "priority" "Priority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Complaint" ADD COLUMN "resolvedAt" TIMESTAMP(3);

UPDATE "Complaint" c SET "organizationId" = d."organizationId" FROM "Department" d WHERE d."id" = c."departmentId";
UPDATE "Complaint" SET "memberId" = "studentId";

ALTER TABLE "Complaint" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Complaint" ALTER COLUMN "memberId" SET NOT NULL;

ALTER TABLE "Complaint" DROP CONSTRAINT IF EXISTS "Complaint_studentId_fkey";
DROP INDEX IF EXISTS "Complaint_studentId_idx";
DROP INDEX IF EXISTS "Complaint_departmentId_idx";
DROP INDEX IF EXISTS "Complaint_status_idx";
ALTER TABLE "Complaint" DROP COLUMN "imageUrl", DROP COLUMN "studentId";

-- ============================================================
-- 10. Notification: rename read->isRead, backfill organizationId (single
--     org, verified), type/title with no historical equivalent get an
--     honestly-labeled GENERAL type and a title derived from the message.
-- ============================================================
ALTER TABLE "Notification" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "entityId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "entityType" TEXT;
ALTER TABLE "Notification" ADD COLUMN "title" TEXT;
ALTER TABLE "Notification" ADD COLUMN "type" "NotificationType";

UPDATE "Notification" SET "organizationId" = (SELECT "id" FROM "Organization" LIMIT 1);
UPDATE "Notification" SET "isRead" = "read";
UPDATE "Notification" SET "type" = 'GENERAL';
UPDATE "Notification" SET "title" = LEFT("message", 60);

ALTER TABLE "Notification" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "title" SET NOT NULL;

DROP INDEX IF EXISTS "Notification_userId_idx";
ALTER TABLE "Notification" DROP COLUMN "read";

-- ============================================================
-- 11. Otp: drop stale/expired rows (only row present was already expired
--     months ago, with a lowercase legacy purpose value that wouldn't cast
--     cleanly anyway), then convert purpose to the enum on an empty table.
-- ============================================================
DELETE FROM "Otp" WHERE "otpExpiry" < NOW();
ALTER TABLE "Otp" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Otp" ALTER COLUMN "purpose" DROP DEFAULT;
ALTER TABLE "Otp" ALTER COLUMN "purpose" TYPE "OtpPurpose" USING (UPPER("purpose")::"OtpPurpose");
DROP INDEX IF EXISTS "Otp_email_purpose_key";

-- (step 12's table drops moved up into step 6 — PendingStaff.role still
-- referenced the old "Role" type, which blocked DROP TYPE "Role" below)

-- ============================================================
-- 13. Foreign keys, unique constraints, indexes
--     The 6 pre-existing FKs below are ON DELETE CASCADE today; the new
--     schema deliberately switches them to RESTRICT (Prisma's default for
--     required relations, which schema.prisma never overrides). CASCADE
--     here would mean deleting one Organization silently wipes every
--     department/building/area/asset/category under it — RESTRICT forces
--     explicit cleanup instead, which is the correct behavior for a
--     multi-tenant platform. Must drop before the matching AddForeignKey
--     below can succeed.
-- ============================================================
ALTER TABLE "Area" DROP CONSTRAINT "Area_buildingId_fkey";
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_areaId_fkey";
ALTER TABLE "Building" DROP CONSTRAINT "Building_departmentId_fkey";
ALTER TABLE "Department" DROP CONSTRAINT "Department_organizationId_fkey";
ALTER TABLE "DepartmentCategory" DROP CONSTRAINT "DepartmentCategory_departmentId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "ResourceAllocation_departmentId_idx" ON "ResourceAllocation"("departmentId");
CREATE INDEX "ResourceAllocation_organizationId_idx" ON "ResourceAllocation"("organizationId");
CREATE INDEX "OrganizationMembership_organizationId_idx" ON "OrganizationMembership"("organizationId");
CREATE INDEX "OrganizationMembership_departmentId_idx" ON "OrganizationMembership"("departmentId");
CREATE UNIQUE INDEX "OrganizationMembership_userId_organizationId_key" ON "OrganizationMembership"("userId", "organizationId");
CREATE UNIQUE INDEX "AdminScope_membershipId_key" ON "AdminScope"("membershipId");
CREATE INDEX "PendingUser_organizationId_idx" ON "PendingUser"("organizationId");
CREATE INDEX "PendingUser_expiresAt_idx" ON "PendingUser"("expiresAt");
CREATE UNIQUE INDEX "PendingUser_organizationId_email_key" ON "PendingUser"("organizationId", "email");
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");
CREATE INDEX "ComplaintEvent_complaintId_idx" ON "ComplaintEvent"("complaintId");
CREATE INDEX "ComplaintEvent_organizationId_idx" ON "ComplaintEvent"("organizationId");
CREATE INDEX "ComplaintComment_complaintId_idx" ON "ComplaintComment"("complaintId");
CREATE INDEX "ComplaintAttachment_complaintId_idx" ON "ComplaintAttachment"("complaintId");
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX "ComplaintInsight_organizationId_idx" ON "ComplaintInsight"("organizationId");
CREATE INDEX "ComplaintInsight_departmentId_idx" ON "ComplaintInsight"("departmentId");
CREATE INDEX "ChatSession_userId_idx" ON "ChatSession"("userId");
CREATE INDEX "ChatSession_organizationId_idx" ON "ChatSession"("organizationId");
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");
CREATE INDEX "Area_organizationId_idx" ON "Area"("organizationId");
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");
CREATE INDEX "Building_organizationId_idx" ON "Building"("organizationId");
CREATE INDEX "Complaint_organizationId_idx" ON "Complaint"("organizationId");
CREATE INDEX "Complaint_departmentId_status_idx" ON "Complaint"("departmentId", "status");
CREATE INDEX "Complaint_memberId_idx" ON "Complaint"("memberId");
CREATE INDEX "Complaint_assignedStaffId_idx" ON "Complaint"("assignedStaffId");
CREATE INDEX "Complaint_categoryId_idx" ON "Complaint"("categoryId");
CREATE UNIQUE INDEX "Department_organizationId_code_key" ON "Department"("organizationId", "code");
DROP INDEX IF EXISTS "Department_code_key";
CREATE INDEX "DepartmentCategory_organizationId_idx" ON "DepartmentCategory"("organizationId");
CREATE UNIQUE INDEX "DepartmentCategory_departmentId_name_key" ON "DepartmentCategory"("departmentId", "name");
DROP INDEX IF EXISTS "DepartmentCategory_departmentId_idx";
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");
CREATE INDEX "Otp_email_purpose_idx" ON "Otp"("email", "purpose");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DepartmentCategory" ADD CONSTRAINT "DepartmentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DepartmentCategory" ADD CONSTRAINT "DepartmentCategory_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Building" ADD CONSTRAINT "Building_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Building" ADD CONSTRAINT "Building_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Area" ADD CONSTRAINT "Area_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Area" ADD CONSTRAINT "Area_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminScope" ADD CONSTRAINT "AdminScope_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingUser" ADD CONSTRAINT "PendingUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintEvent" ADD CONSTRAINT "ComplaintEvent_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintEvent" ADD CONSTRAINT "ComplaintEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplaintComment" ADD CONSTRAINT "ComplaintComment_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintComment" ADD CONSTRAINT "ComplaintComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintAttachment" ADD CONSTRAINT "ComplaintAttachment_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintAttachment" ADD CONSTRAINT "ComplaintAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplaintInsight" ADD CONSTRAINT "ComplaintInsight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintInsight" ADD CONSTRAINT "ComplaintInsight_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
