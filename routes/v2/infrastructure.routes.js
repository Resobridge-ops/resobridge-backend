// routes/v2/infrastructure.routes.js
//
// Buildings, recursive Areas, and Assets. Reads are org-wide for any
// authenticated role (members need to browse the structure to locate a
// complaint). Writes are ORG_ADMIN (unrestricted within their org) or ADMIN
// (scoped via AdminScope.departmentIds, checked through the owning
// department resolved by walking area -> building -> department, or
// asset -> area -> building -> department).
//
// Re-parenting (moving a building to a different department, an area to a
// different building/parent, an asset to a different area) is out of scope
// for this pass — PATCH only touches the entity's own descriptive fields.
// Deletes are soft (status/isActive flip), not hard deletes, since all three
// can be referenced by historical complaints.

const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");
const { authenticate, authorizeRoles, hasDepartmentAccess } = require("../../middleware/authenticate");

router.use(authenticate);

const canWrite = authorizeRoles("ORG_ADMIN", "ADMIN");

function requireAdminScope(req, res) {
  if (req.user.role === "ADMIN" && !req.user.adminScope) {
    res.status(403).json({ success: false, message: "No admin scope configured for this account." });
    return false;
  }
  return true;
}

// ── Buildings ────────────────────────────────────────────────

router.get("/buildings", async (req, res) => {
  try {
    const { departmentId } = req.query;
    const buildings = await prisma.building.findMany({
      where: {
        organizationId: req.user.organizationId,
        ...(departmentId && { departmentId }),
      },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: buildings });
  } catch (error) {
    console.error("List buildings error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/buildings/:buildingId", async (req, res) => {
  try {
    const building = await prisma.building.findFirst({
      where: { id: req.params.buildingId, organizationId: req.user.organizationId },
    });
    if (!building) return res.status(404).json({ success: false, message: "Building not found." });
    return res.json({ success: true, data: building });
  } catch (error) {
    console.error("Get building error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/buildings", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const { departmentId, name, description, type, location, status } = req.body;
    if (!departmentId || !name || !type) {
      return res.status(400).json({ success: false, message: "departmentId, name, and type are required." });
    }

    const department = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: req.user.organizationId },
    });
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found." });
    }
    if (!hasDepartmentAccess(req.user, departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    const building = await prisma.building.create({
      data: {
        organizationId: req.user.organizationId,
        departmentId,
        name,
        description,
        type,
        location,
        ...(status && { status }),
      },
    });
    return res.status(201).json({ success: true, data: building });
  } catch (error) {
    console.error("Create building error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/buildings/:buildingId", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const building = await prisma.building.findFirst({
      where: { id: req.params.buildingId, organizationId: req.user.organizationId },
    });
    if (!building) return res.status(404).json({ success: false, message: "Building not found." });
    if (!hasDepartmentAccess(req.user, building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    const { name, description, type, location, status } = req.body;
    const updated = await prisma.building.update({
      where: { id: building.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(type !== undefined && { type }),
        ...(location !== undefined && { location }),
        ...(status !== undefined && { status }),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update building error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.delete("/buildings/:buildingId", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const building = await prisma.building.findFirst({
      where: { id: req.params.buildingId, organizationId: req.user.organizationId },
    });
    if (!building) return res.status(404).json({ success: false, message: "Building not found." });
    if (!hasDepartmentAccess(req.user, building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    await prisma.building.update({ where: { id: building.id }, data: { status: "CLOSED" } });
    return res.json({ success: true, message: "Building marked closed." });
  } catch (error) {
    console.error("Delete building error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Areas (recursive) ────────────────────────────────────────

router.get("/areas", async (req, res) => {
  try {
    // ?topLevel=true -> only areas with no parent (parentId IS NULL, which
    // a query string can't express directly). ?parentId=<id> -> children of
    // that specific area. Neither given -> every area in the building/org,
    // for clients that want to assemble the tree themselves.
    const { buildingId, parentId, topLevel } = req.query;
    const areas = await prisma.area.findMany({
      where: {
        organizationId: req.user.organizationId,
        isActive: true,
        ...(buildingId && { buildingId }),
        ...(topLevel === "true" && { parentId: null }),
        ...(parentId && { parentId }),
      },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: areas });
  } catch (error) {
    console.error("List areas error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/areas/:areaId", async (req, res) => {
  try {
    const area = await prisma.area.findFirst({
      where: { id: req.params.areaId, organizationId: req.user.organizationId },
      include: { children: true },
    });
    if (!area) return res.status(404).json({ success: false, message: "Area not found." });
    return res.json({ success: true, data: area });
  } catch (error) {
    console.error("Get area error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/areas", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const { buildingId, parentId, name, type, locationType, description } = req.body;
    if (!buildingId || !name || !type || !locationType) {
      return res.status(400).json({ success: false, message: "buildingId, name, type, and locationType are required." });
    }

    const building = await prisma.building.findFirst({
      where: { id: buildingId, organizationId: req.user.organizationId },
    });
    if (!building) return res.status(404).json({ success: false, message: "Building not found." });
    if (!hasDepartmentAccess(req.user, building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    if (parentId) {
      const parent = await prisma.area.findFirst({
        where: { id: parentId, buildingId, organizationId: req.user.organizationId },
      });
      if (!parent) {
        return res.status(400).json({ success: false, message: "parentId must reference an area within the same building." });
      }
    }

    const area = await prisma.area.create({
      data: {
        organizationId: req.user.organizationId,
        buildingId,
        parentId: parentId || null,
        name,
        type,
        locationType,
        description,
      },
    });
    return res.status(201).json({ success: true, data: area });
  } catch (error) {
    console.error("Create area error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/areas/:areaId", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const area = await prisma.area.findFirst({
      where: { id: req.params.areaId, organizationId: req.user.organizationId },
      include: { building: true },
    });
    if (!area) return res.status(404).json({ success: false, message: "Area not found." });
    if (!hasDepartmentAccess(req.user, area.building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    const { name, type, locationType, description, isActive } = req.body;
    const updated = await prisma.area.update({
      where: { id: area.id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(locationType !== undefined && { locationType }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update area error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.delete("/areas/:areaId", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const area = await prisma.area.findFirst({
      where: { id: req.params.areaId, organizationId: req.user.organizationId },
      include: { building: true },
    });
    if (!area) return res.status(404).json({ success: false, message: "Area not found." });
    if (!hasDepartmentAccess(req.user, area.building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    await prisma.area.update({ where: { id: area.id }, data: { isActive: false } });
    return res.json({ success: true, message: "Area deactivated." });
  } catch (error) {
    console.error("Delete area error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ── Assets ───────────────────────────────────────────────────

router.get("/assets", async (req, res) => {
  try {
    const { areaId } = req.query;
    const assets = await prisma.asset.findMany({
      where: {
        organizationId: req.user.organizationId,
        isActive: true,
        ...(areaId && { areaId }),
      },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: assets });
  } catch (error) {
    console.error("List assets error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/assets/:assetId", async (req, res) => {
  try {
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.assetId, organizationId: req.user.organizationId },
    });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found." });
    return res.json({ success: true, data: asset });
  } catch (error) {
    console.error("Get asset error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/assets", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const {
      areaId,
      name,
      description,
      condition,
      quantity,
      totalCost,
      costOfMaintenance,
      lastInspected,
      nextInspectionDue,
      notes,
    } = req.body;
    if (!areaId || !name) {
      return res.status(400).json({ success: false, message: "areaId and name are required." });
    }

    const area = await prisma.area.findFirst({
      where: { id: areaId, organizationId: req.user.organizationId },
      include: { building: true },
    });
    if (!area) return res.status(404).json({ success: false, message: "Area not found." });
    if (!hasDepartmentAccess(req.user, area.building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    const asset = await prisma.asset.create({
      data: {
        organizationId: req.user.organizationId,
        areaId,
        name,
        description,
        ...(condition && { condition }),
        ...(quantity !== undefined && { quantity }),
        ...(totalCost !== undefined && { totalCost }),
        ...(costOfMaintenance !== undefined && { costOfMaintenance }),
        ...(lastInspected !== undefined && { lastInspected: new Date(lastInspected) }),
        ...(nextInspectionDue !== undefined && { nextInspectionDue: new Date(nextInspectionDue) }),
        notes,
      },
    });
    return res.status(201).json({ success: true, data: asset });
  } catch (error) {
    console.error("Create asset error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/assets/:assetId", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.assetId, organizationId: req.user.organizationId },
      include: { area: { include: { building: true } } },
    });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found." });
    if (!hasDepartmentAccess(req.user, asset.area.building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    const {
      name,
      description,
      condition,
      quantity,
      totalCost,
      costOfMaintenance,
      lastInspected,
      nextInspectionDue,
      notes,
      isActive,
    } = req.body;

    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(condition !== undefined && { condition }),
        ...(quantity !== undefined && { quantity }),
        ...(totalCost !== undefined && { totalCost }),
        ...(costOfMaintenance !== undefined && { costOfMaintenance }),
        ...(lastInspected !== undefined && { lastInspected: new Date(lastInspected) }),
        ...(nextInspectionDue !== undefined && { nextInspectionDue: new Date(nextInspectionDue) }),
        ...(notes !== undefined && { notes }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update asset error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.delete("/assets/:assetId", canWrite, async (req, res) => {
  try {
    if (!requireAdminScope(req, res)) return;
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.assetId, organizationId: req.user.organizationId },
      include: { area: { include: { building: true } } },
    });
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found." });
    if (!hasDepartmentAccess(req.user, asset.area.building.departmentId)) {
      return res.status(403).json({ success: false, message: "Department is outside your admin scope." });
    }

    await prisma.asset.update({ where: { id: asset.id }, data: { isActive: false } });
    return res.json({ success: true, message: "Asset deactivated." });
  } catch (error) {
    console.error("Delete asset error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
