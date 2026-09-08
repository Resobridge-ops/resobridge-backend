# ResoBridge — Backend Architecture Document
# Version 2.0 | For engineers onboarding to this codebase

---

## What ResoBridge is

ResoBridge is a **B2B SaaS complaint and facilities management platform** built for any
type of organisation — universities, hotels, hospitals, oil companies, estates.
Think Jira + Zendesk, but for institutional facilities and complaint management.

It is **not** university-specific. All school-specific language (students, hall porters,
halls, residency admin) has been removed from the architecture. The platform is generic
and organisational.

---

##
Ensure to check all routes and all middleware including login and sign up processes (conclude on whether supabase auth is to be used or our existing auth logic), so the same neutral organisational multitenant logic persists. 

---

## Tech Stack

```
Frontend        React (hosted on Netlify/Vercel)
Backend         Node.js + Express (hosted on Render — persistent server, NOT serverless)
ORM             Prisma
Database        Supabase (Postgres) — replaced MongoDB/Mongoose
Email           Brevo REST API (via axios)
Auth            JWT (7d expiry, stored in JWT_SECRET env var)
File uploads    Multer + Cloudinary (if needed)
```

**Why not serverless?**
ResoBridge needs a persistent server for: background insight generation jobs, OTP expiry
logic, complaint workflow state machines, future IoT/sensor ingestion endpoints.
Serverless functions cannot support this. Express on Render is intentional.

**Why Supabase over MongoDB?**
The data model is inherently relational: organisations contain departments, departments
contain buildings, buildings contain recursive spatial areas, areas contain assets,
complaints reference any combination of the above. Postgres handles this natively.
MongoDB required fighting the tool (graphLookup, manual joins, no referential integrity).

---

## Data Hierarchy

```
Organization
└── Department                    (the tenant unit — chaplaincy, housekeeping, HSE)
    ├── DepartmentCategory        (complaint categories specific to this dept)
    ├── Building                  (physical structures the dept manages)
    │   └── Area (recursive)      (floor → room → zone → subarea → unit, any depth)
    │       └── Asset             (individual trackable items: chairs, AC, projector)
    └── Complaint                 (filed by a Member, handled by Staff, monitored by Admin)
```

### Why Area is recursive (self-referencing)

A fixed-depth model breaks the moment one branch needs more levels than another.
Examples of real depth variance in one organisation (Covenant University Chaplaincy):
- Exterior → Parking Area → Asset (2 levels)
- Exterior → Offices Zone → Service Unit → Reflections Ministry → Asset (4 levels)

The recursive Area model handles both without schema changes. `parentId` is null for
top-level areas; nested areas reference their parent's id.

---

## User Roles

Five roles only. No school-specific titles.

```
SUPERADMIN      ResoBridge platform staff. Manages all organisations on the platform.
                Seeded manually — never self-registers.

ORG_ADMIN       Owns the organisation on ResoBridge. Full visibility across all
                departments in their org. Approves ADMINs and STAFF.

ADMIN           Scoped admin. What they can see and do is defined in AdminScope,
                not hardcoded. Examples:
                  - Chaplaincy admin → scoped to chaplaincy dept, canManageStaff: true
                  - Facilities manager → scoped to 3 depts, canEscalate: true
                  - Oil company HSE lead → scoped to all depts, canExportReports: true
                One role, configurable scope. No ChaplainAdmin / FacilitiesAdmin / etc.

STAFF           Handles and resolves complaints in their department.
                Sees their department's complaint queue only.

MEMBER          Anyone who submits complaints or feedback.
                Could be a student, hotel guest, hospital patient, oil company employee.
                The platform does not care — they are all MEMBER.
                Sees only their own submitted complaints.
```

### AdminScope model

Defines what an ADMIN can access and do. Attached 1:1 to an ADMIN user.

```
departmentIds    String[]   // empty = all departments in the org
canManageStaff   Boolean    // can approve/reject pending staff
canViewAnalytics Boolean    // can see charts and insight reports
canEscalate      Boolean    // can escalate complaints to higher authority
canExportReports Boolean    // can download complaint reports
```

---

## What Each Layer Sees

**MEMBER**
- Submit a complaint (category, location, description, photo)
- Track their own complaints and current status
- Confirm resolution or raise a dispute
- Receive notifications on status changes

**STAFF**
- See their department's complaint queue (new, in progress, awaiting confirmation)
- Accept, update, and resolve complaints
- Add notes and attach updates
- Receive notifications for new complaints

**ADMIN** (within their AdminScope)
- Dashboard: complaint volume, resolution rates, overdue items, area hotspots
- Unified filtered complaint list (filterable by status, area, staff, date — never a raw dump)
- Infrastructure map: buildings, areas, assets and their condition
- Staff management (if canManageStaff)
- Analytics and exportable reports (if canViewAnalytics / canExportReports)
- Escalation controls (if canEscalate)

**ORG_ADMIN**
- Everything ADMIN sees, across all departments
- Manages department configuration and categories
- Approves ADMIN accounts

**SUPERADMIN**
- Onboards new organisations
- Platform-wide visibility
- Manages ORG_ADMINs

---

## Organisation Registration Modes

Each organisation configures how MEMBERs register:

```
OPEN               Anyone on the subdomain can create a MEMBER account
INVITE_ONLY        ORG_ADMIN or ADMIN must send an invite link
DOMAIN_RESTRICTED  Only emails matching allowedEmailDomain can register
                   e.g. @covenantuniversity.edu.ng
```

Stored on the Organization model. Registration endpoint checks this before proceeding.

---

## Complaint Workflow

```
PENDING → IN_PROGRESS → AWAITING_CONFIRMATION → RESOLVED

```

A complaint optionally references a specific Area and/or Asset for precise location
tracking. A free-text `location` field exists as a fallback while the frontend area
picker is being built.

---

## AI Insights Layer

Insights are **not** generated on every page load or on a fixed schedule.

**Trigger logic:**
```
Generate new insights when:
  - 20 new complaints since last insight run   ← volume trigger
  OR
  - 60 days since last run                     ← time ceiling (safety net)
  whichever comes first
```

Two fields on Department (or Organization):
```
lastInsightRun        DateTime
complaintsSinceRun    Int
```

Every complaint submission increments `complaintsSinceRun`. A background job checks
periodically and fires the insight generation when threshold is crossed, then resets
both fields.

Output is stored in the database and served to the frontend on demand. The LLM is
called only on threshold trigger — not on every dashboard view.

Historical complaint data imported on org onboarding triggers an immediate insight run
(cold start solution).

---

## Supabase Schema — Current State

The database has been migrated to Supabase and seeded. Tables exist and are live.

**Note:** The database was initially migrated from an older version of the schema.
Some column names are legacy and need a migration to match the target architecture.

### Legacy columns that need migration (post-exam task)
```
User.studentId / User.staffId    → rename to User.memberId
User (missing organizationId)    → add organizationId column
Complaint.studentId              → rename to Complaint.memberId
PendingStudent + PendingStaff    → merge into single PendingUser table
Role enum values                 → STUDENT → MEMBER, DEPARTMENT_ADMIN → ADMIN, add ORG_ADMIN
Organization (missing fields)    → add status, memberRegistration, allowedEmailDomain
AdminScope table                 → does not exist yet, needs creating
```

### Tables currently in Supabase
Organization, Department, DepartmentCategory, User, Building, Area, Asset,
Complaint, Otp, Notification, PendingStudent, PendingStaff, _prisma_migrations

### Enums currently in Supabase
```
Role:            STUDENT | STAFF | DEPARTMENT_ADMIN | SUPERADMIN   (needs updating)
Status:          ACTIVE | INACTIVE
BuildingStatus:  OPERATIONAL | UNDER_MAINTENANCE | CLOSED
LocationType:    INTERIOR | EXTERIOR
Condition:       GOOD | MEDIUM | BAD
ComplaintStatus: PENDING | IN_PROGRESS | AWAITING_CONFIRMATION | RESOLVED | DISPUTED | EXPIRED
```

---

## Current Backend Codebase — What Exists and What Changes

The backend repo (`resobridge-backend`, branch: `test/backend`) still runs on
MongoDB/Mongoose. The task is a full Mongoose → Prisma migration.

### What stays (reuse with minor edits)
```
index.js              Keep Express setup, CORS config, multer, port listener.
                      Remove: mongoose.connect(), all inline Mongoose model imports,
                      all inline route handlers (extract to route files).

utils/sendOTP.js      Rename to utils/sendEmail.js. Consolidate all email functions
                      here. Keep Brevo axios pattern.

routes/chatbot.js     Keep as-is. Wire to Prisma client instead of Mongoose models.
routes/intelligence.js Keep as-is. Same.

middleware/auth.js    Keep JWT verify logic. Update role names to match new enum.
```

### What gets deleted entirely
```
models/Hall.js              → replaced by Building + Department in Prisma schema
models/ComplaintType.js     → replaced by DepartmentCategory
models/PendingStudent.js    → replaced by PendingUser
models/PendingHallPorter.js → replaced by PendingUser
models/PendingAdmin.js      → replaced by PendingUser
models/User.js              → replaced by Prisma schema
models/Complaint.js         → replaced by Prisma schema
models/Otp.js               → replaced by Prisma schema
models/Notification.js      → replaced by Prisma schema
middleware/admin.js         → logic moves into route files scoped by role
utils/sendHpApproval.js     → merged into sendEmail.js (hall porter = staff now)
utils/sendPorterNotification.js → merged into sendEmail.js
```

### What gets created
```
prisma/schema.prisma        check if alrady written or just write it
prisma/client.js            Prisma singleton: const prisma = new PrismaClient()
routes/v2/auth.routes.js    Register, verify OTP, login, approve, forgot/reset password
routes/v2/department.routes.js  CRUD for departments and categories
routes/v2/infrastructure.routes.js  Buildings, areas, assets
routes/v2/complaint.routes.js   Submit, track, update status, confirm, dispute
routes/v2/admin.routes.js   Dashboard stats, staff management, scoped complaint views
routes/v2/member.routes.js  Member profile, their complaints
middleware/authenticate.js  authenticate + authorizeRoles + authorizeDepartment
utils/sendEmail.js          All Brevo email functions consolidated
```

---

## Environment Variables

```
DATABASE_URL        Supabase connection string (Postgres URI from Supabase settings)
JWT_SECRET          Secret for signing JWTs
BREVO_API_KEY       Brevo API key for transactional email
BREVO_SENDER_EMAIL  Sending email address (e.g. noreply@resobridge.app)
FRONTEND_URL        Frontend base URL (for password reset links)
```

---

## How to Prompt Claude Effectively for This Codebase

When starting a new Claude session for ResoBridge backend work:

1. Paste this entire ARCHITECTURE.md as your first message
2. Then paste the specific file you are working on
3. State exactly what you want: "Rewrite this route file replacing all Mongoose 
   queries with Prisma. Use the role names MEMBER/STAFF/ADMIN/ORG_ADMIN/SUPERADMIN.
   Remove all references to Hall, student, hallporter. Keep Express structure."
4. Ask for one file at a time — not the whole backend at once
5. Always specify: "Do not use serverless. Keep Express."

### Rewrite order (do files in this sequence)
```
1. prisma/client.js              (5 lines — done in 1 minute)
2. middleware/authenticate.js    (role guards)
3. utils/sendEmail.js            (consolidate all email utils)
4. routes/v2/auth.routes.js      (most critical — everything gates on this)
5. routes/v2/department.routes.js
6. routes/v2/infrastructure.routes.js
7. routes/v2/complaint.routes.js
8. routes/v2/admin.routes.js
9. index.js                      (clean up last — remove Mongoose, register new routes)
10. routes/chatbot.js            (wire to Prisma)
11. routes/intelligence.js       (wire to Prisma)
```

---



