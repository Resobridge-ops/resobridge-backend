-- Adds the REOPENED event type for the dedicated Reopen Request action
-- (TARGET.md). Purely additive — ALTER TYPE ... ADD VALUE only extends
-- the enum's catalog entry, no existing ComplaintEvent rows are touched.

ALTER TYPE "ComplaintEventType" ADD VALUE 'REOPENED';
