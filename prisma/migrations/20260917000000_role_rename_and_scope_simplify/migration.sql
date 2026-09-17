-- Hand-authored migration, per TARGET.md's locked role model:
--   ADMIN -> DEPT_ADMIN, MEMBER -> REQUESTER (Role enum)
--   AdminScope simplified to department-scoping only — the five
--   independent capability flags (canManageStaff/canViewAnalytics/
--   canEscalate/canExportReports/canManageCategories) are dropped;
--   a DEPT_ADMIN now has full rights within their assigned department(s),
--   no picking-and-choosing capabilities.
--
-- ALTER TYPE ... RENAME VALUE is a catalog-only relabel — it does not
-- rewrite Role column data, so every existing OrganizationMembership,
-- PendingUser, and Invitation row keeps its role with zero data loss.

BEGIN;

ALTER TYPE "Role" RENAME VALUE 'ADMIN' TO 'DEPT_ADMIN';
ALTER TYPE "Role" RENAME VALUE 'MEMBER' TO 'REQUESTER';

ALTER TABLE "AdminScope"
  DROP COLUMN "canManageStaff",
  DROP COLUMN "canViewAnalytics",
  DROP COLUMN "canEscalate",
  DROP COLUMN "canExportReports",
  DROP COLUMN "canManageCategories";

COMMIT;
