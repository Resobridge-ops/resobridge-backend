# Infrastructure Management Database Schema

This document describes the database schema for the Chapel Infrastructure Management System.

## Entity Relationship Diagram

```
Infrastructure (1) ────────┬────────── (N) Item
     │                      │
     │                      ├──────── (N) ItemDetail
     │                      │
     │                      └──────── (N) Entrance
     │
     ├──────── (N) Zone
     │
     └──────── (N) ServiceUnit
```

## Collections/Models

### 1. Infrastructure

Represents a physical building or facility (e.g., a chapel).

```json
{
  "_id": ObjectId,
  "userId": ObjectId (ref: User),
  "name": "String (required)",
  "description": "String",
  "type": "Enum: ['chapel', 'dormitory', 'lecture_hall', 'library', 'administrative', 'other']",
  "location": "String",
  "status": "Enum: ['operational', 'under_maintenance', 'closed']",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:**
- `userId` (for quick lookup of user's infrastructures)

---

### 2. Zone

Represents areas/zones within an infrastructure.

```json
{
  "_id": ObjectId,
  "infrastructureId": ObjectId (ref: Infrastructure, required),
  "name": "String (required)",
  "description": "String",
  "zoneType": "String",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:**
- `infrastructureId` (for quick lookup of zones in an infrastructure)

**Use Cases:**
- Ground floor, First floor, etc.
- Sanctuary, Prayer room, Choir room
- Front section, Back section

---

### 3. Item

Represents items within an infrastructure (doors, windows, walls, etc.).

```json
{
  "_id": ObjectId,
  "infrastructureId": ObjectId (ref: Infrastructure, required),
  "sectionType": "Enum: ['interior', 'exterior'] (required)",
  "zoneId": ObjectId (ref: Zone, optional),
  "name": "String (required)",
  "description": "String",
  "condition": "Enum: ['good', 'medium', 'bad']",
  "quantity": "Number",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:**
- `infrastructureId` (for quick lookup of items in an infrastructure)

**Use Cases:**
- Doors (interior & exterior)
- Windows
- Walls
- Flooring
- Roof
- Electrical systems
- Plumbing fixtures

---

### 4. ItemDetail

Detailed information about items (maintenance history, costs, etc.).

```json
{
  "_id": ObjectId,
  "itemId": ObjectId (ref: Item, required, unique),
  "totalCost": "Decimal128",
  "totalNumber": "String",
  "costOfMaintenance": "Decimal128",
  "lastInspected": "String (date string)",
  "nextInspectionDue": "Date",
  "notes": "String",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:**
- `itemId` (unique index for one-to-one relationship)

**Use Cases:**
- Track maintenance costs and history
- Schedule inspections
- Record condition assessments
- Store maintenance notes

---

### 5. Entrance

Sub-items within items, typically doors/windows with specific conditions.

```json
{
  "_id": ObjectId,
  "itemId": ObjectId (ref: Item, required),
  "name": "String (required)",
  "count": "Number",
  "needsMaintenance": "Boolean",
  "willNeedMaintenance": "Boolean",
  "maintenanceDate": "String (date string)",
  "condition": "Enum: ['good', 'medium', 'bad']",
  "hasEquipment": "String",
  "location": "String",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:**
- `itemId` (for quick lookup of entrances for an item)

**Use Cases:**
- Front entrance door
- Side exit door
- Main sanctuary doors
- Clerestory windows
- Vestry door with lock system

---

### 6. ServiceUnit

Service units within an infrastructure (e.g., electrical, plumbing systems).

```json
{
  "_id": ObjectId,
  "infrastructureId": ObjectId (ref: Infrastructure, required),
  "name": "String (required)",
  "description": "String",
  "serviceType": "Enum: ['electrical', 'plumbing', 'hvac', 'cleaning', 'security', 'other']",
  "status": "Enum: ['active', 'inactive', 'maintenance']",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:**
- `infrastructureId` (for quick lookup of service units in an infrastructure)

**Use Cases:**
- Main electrical panel
- Backup generator
- Water supply system
- HVAC/AC system
- Security system
- Cleaning/maintenance supplies storage

---

## Data Flow & Relationships

### Creating Infrastructure

```
POST /api/infrastructure
{
  "userId": "user-id",
  "name": "Main Chapel",
  "description": "Central place of worship",
  "type": "chapel",
  "location": "Campus Center",
  "status": "operational"
}
```

### Adding Items to Infrastructure

```
POST /api/infrastructure/:id/sections/:sectionType/items
{
  "name": "Front Doors",
  "description": "Main entrance doors",
  "condition": "good",
  "quantity": 2,
  "zoneId": "optional-zone-id"
}
```

### Adding Item Details

```
PUT /api/infrastructure/:id/items/:itemId
{
  "totalCost": 5000,
  "totalNumber": "2",
  "costOfMaintenance": 200,
  "lastInspected": "2025-03-15",
  "nextInspectionDue": "2026-03-15"
}
```

### Adding Entrances to Items

```
POST /api/infrastructure/:id/items/:itemId/entrances
{
  "name": "Left Door",
  "count": 1,
  "condition": "good",
  "hasEquipment": "Electronic lock system",
  "location": "Front left"
}
```

---

## Scalability Considerations

1. **Indexing**: All foreign keys are indexed for performance
2. **References**: Uses MongoDB ObjectId references for relational queries
3. **Timestamps**: Automatic tracking of creation/modification times
4. **Enums**: Predefined values to ensure data consistency

---

## Example Document Structure

### Complete Infrastructure with All Related Documents

```javascript
// Infrastructure
{
  _id: ObjectId("..."),
  userId: ObjectId("..."),
  name: "Main Chapel",
  description: "Central place of worship",
  type: "chapel",
  location: "Campus Center",
  status: "operational"
}

// Related Zones
[
  { _id: ObjectId("..."), infrastructureId: ObjectId("..."), name: "Sanctuary", zoneType: "main" },
  { _id: ObjectId("..."), infrastructureId: ObjectId("..."), name: "Vestry", zoneType: "auxiliary" }
]

// Related Items
[
  { _id: ObjectId("..."), infrastructureId: ObjectId("..."), sectionType: "exterior", name: "Front Doors", condition: "good" },
  { _id: ObjectId("..."), infrastructureId: ObjectId("..."), sectionType: "interior", name: "Stained Glass Windows", condition: "medium" }
]

// Related Item Details
{
  _id: ObjectId("..."),
  itemId: ObjectId("..."),
  totalCost: 5000,
  costOfMaintenance: 200,
  lastInspected: "2025-03-15"
}

// Related Entrances
[
  { _id: ObjectId("..."), itemId: ObjectId("..."), name: "Left Door", condition: "good" },
  { _id: ObjectId("..."), itemId: ObjectId("..."), name: "Right Door", condition: "medium" }
]

// Related Service Units
[
  { _id: ObjectId("..."), infrastructureId: ObjectId("..."), name: "Electrical Panel", serviceType: "electrical", status: "active" },
  { _id: ObjectId("..."), infrastructureId: ObjectId("..."), name: "HVAC System", serviceType: "hvac", status: "active" }
]
```

---

## Notes

- All dates follow ISO 8601 format
- Monetary values use Decimal128 for precision
- Enums ensure data consistency across the application
- The schema supports both one-to-many and optional relationships
- User authorization is enforced at the API level (userId check)
