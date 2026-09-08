## Table `_prisma_migrations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `varchar` | Primary |
| `checksum` | `varchar` |  |
| `finished_at` | `timestamptz` |  Nullable |
| `migration_name` | `varchar` |  |
| `logs` | `text` |  Nullable |
| `rolled_back_at` | `timestamptz` |  Nullable |
| `started_at` | `timestamptz` |  |
| `applied_steps_count` | `int4` |  |

## Table `Organization`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `name` | `text` |  |
| `slug` | `text` |  |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `Department`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `organizationId` | `text` |  |
| `name` | `text` |  |
| `code` | `text` |  |
| `type` | `text` |  |
| `description` | `text` |  Nullable |
| `email` | `text` |  |
| `status` | `Status` |  |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `DepartmentCategory`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `departmentId` | `text` |  |
| `name` | `text` |  |
| `description` | `text` |  Nullable |
| `subcategories` | `_text` |  Nullable |
| `status` | `Status` |  |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `User`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `fullName` | `text` |  Nullable |
| `email` | `text` |  |
| `password` | `text` |  Nullable |
| `role` | `Role` |  |
| `position` | `text` |  Nullable |
| `departmentId` | `text` |  Nullable |
| `studentId` | `text` |  Nullable |
| `staffId` | `text` |  Nullable |
| `isApproved` | `bool` |  |
| `forcePasswordReset` | `bool` |  |
| `resetToken` | `text` |  Nullable |
| `resetTokenExpiry` | `timestamp` |  Nullable |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `PendingStudent`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `fullName` | `text` |  |
| `email` | `text` |  |
| `studentId` | `text` |  |
| `password` | `text` |  |
| `createdAt` | `timestamp` |  |

## Table `PendingStaff`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `fullName` | `text` |  |
| `email` | `text` |  |
| `password` | `text` |  Nullable |
| `staffId` | `text` |  |
| `position` | `text` |  Nullable |
| `role` | `Role` |  |
| `departmentId` | `text` |  |
| `createdAt` | `timestamp` |  |

## Table `Otp`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `email` | `text` |  |
| `otp` | `text` |  |
| `purpose` | `text` |  |
| `otpExpiry` | `timestamp` |  |
| `createdAt` | `timestamp` |  |

## Table `Notification`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `userId` | `text` |  |
| `message` | `text` |  |
| `read` | `bool` |  |
| `createdAt` | `timestamp` |  |

## Table `Building`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `departmentId` | `text` |  |
| `name` | `text` |  |
| `description` | `text` |  Nullable |
| `type` | `text` |  |
| `location` | `text` |  Nullable |
| `status` | `BuildingStatus` |  |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `Area`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `buildingId` | `text` |  |
| `parentId` | `text` |  Nullable |
| `name` | `text` |  |
| `type` | `text` |  |
| `locationType` | `LocationType` |  |
| `description` | `text` |  Nullable |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `Asset`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `areaId` | `text` |  |
| `name` | `text` |  |
| `description` | `text` |  Nullable |
| `condition` | `Condition` |  |
| `quantity` | `int4` |  |
| `totalCost` | `numeric` |  Nullable |
| `costOfMaintenance` | `numeric` |  Nullable |
| `lastInspected` | `timestamp` |  Nullable |
| `nextInspectionDue` | `timestamp` |  Nullable |
| `notes` | `text` |  Nullable |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `Complaint`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `title` | `text` |  |
| `description` | `text` |  |
| `status` | `ComplaintStatus` |  |
| `location` | `text` |  Nullable |
| `imageUrl` | `text` |  Nullable |
| `votes` | `int4` |  |
| `departmentId` | `text` |  |
| `categoryId` | `text` |  |
| `areaId` | `text` |  Nullable |
| `assetId` | `text` |  Nullable |
| `studentId` | `text` |  |
| `assignedStaffId` | `text` |  Nullable |
| `createdAt` | `timestamp` |  |
| `updatedAt` | `timestamp` |  |

## Table `complaintsInsights`

history of complaint insights

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `created_at` | `timestamptz` |  |
| `summary` | `text` |  Nullable |
| `observations` | `jsonb` |  Nullable |
| `hypotheses` | `jsonb` |  Nullable |
| `anomalies` | `jsonb` |  Nullable |
| `recommendations` | `jsonb` |  Nullable |
| `complaintCount` | `int8` |  Nullable |

## Custom Types / Enums

### `Role`

`STUDENT` | `STAFF` | `DEPARTMENT_ADMIN` | `SUPERADMIN`

### `Status`

`ACTIVE` | `INACTIVE`

### `BuildingStatus`

`OPERATIONAL` | `UNDER_MAINTENANCE` | `CLOSED`

### `LocationType`

`INTERIOR` | `EXTERIOR`

### `Condition`

`GOOD` | `MEDIUM` | `BAD`

### `ComplaintStatus`

`PENDING` | `IN_PROGRESS` | `AWAITING_CONFIRMATION` | `RESOLVED` | `DISPUTED` | `EXPIRED`

