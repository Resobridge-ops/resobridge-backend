const express = require('express');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const Infrastructure = require('../models/Infrastructure');
const Item = require('../models/Item');
const ItemDetail = require('../models/ItemDetail');
const Entrance = require('../models/Entrance');
const Zone = require('../models/Zone');
const ServiceUnit = require('../models/ServiceUnit');

const router = express.Router();

const getPagination = (req) => {
  const page = Number(req.query.page) >= 1 ? Math.floor(Number(req.query.page)) : 1;
  const limit = Number(req.query.limit) >= 1 ? Math.min(Math.floor(Number(req.query.limit)), 100) : 20;
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip
  };
};

// Middleware to ensure user owns the infrastructure
const ensureOwnership = async (req, res, next) => {
  try {
    const { id } = req.params;
    const infrastructure = await Infrastructure.findById(id);

    if (!infrastructure) {
      return res.status(404).json({ 
        success: false, 
        statusCode: 404, 
        message: 'Infrastructure not found' 
      });
    }

    if (infrastructure.userId.toString() !== req.user.userId) {
      return res.status(403).json({ 
        success: false, 
        statusCode: 403, 
        message: 'Access denied. You do not own this resource.' 
      });
    }

    req.infrastructure = infrastructure;
    next();
  } catch (error) {
    console.error('Ownership check error:', error);
    res.status(500).json({ 
      success: false, 
      statusCode: 500, 
      message: 'Internal server error' 
    });
  }
};

// ==================== INFRASTRUCTURE CRUD ====================

// GET /api/infrastructure - Get all infrastructures for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const filter = { userId: req.user.userId };
    const total = await Infrastructure.countDocuments(filter);
    const infrastructures = await Infrastructure.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: infrastructures,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get infrastructures error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/infrastructure/:id - Get single infrastructure
router.get('/:id', authenticateToken, ensureOwnership, async (req, res) => {
  res.json(req.infrastructure);
});

// POST /api/infrastructure - Create new infrastructure
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, type, location, status } = req.body;

    // Input validation
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
    }

    if (description && typeof description !== 'string') {
      return res.status(400).json({ message: 'Description must be a string' });
    }

    if (type && typeof type !== 'string') {
      return res.status(400).json({ message: 'Type must be a string' });
    }

    if (location && typeof location !== 'string') {
      return res.status(400).json({ message: 'Location must be a string' });
    }

    if (status && !['operational', 'maintenance', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Status must be one of: operational, maintenance, inactive' });
    }

    const infrastructure = new Infrastructure({
      userId: req.user.userId,
      name: name.trim(),
      description: description ? description.trim() : '',
      type: type || 'building',
      location: location || '',
      status: status || 'operational'
    });

    await infrastructure.save();
    res.status(201).json(infrastructure);
  } catch (error) {
    console.error('Create infrastructure error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/infrastructure/:id - Update infrastructure
router.put('/:id', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { name, description, type, location, status } = req.body;

    // Input validation
    if (name && (typeof name !== 'string' || name.trim().length < 1)) {
      return res.status(400).json({ message: 'Name must be a non-empty string' });
    }

    if (description && typeof description !== 'string') {
      return res.status(400).json({ message: 'Description must be a string' });
    }

    if (type && typeof type !== 'string') {
      return res.status(400).json({ message: 'Type must be a string' });
    }

    if (location && typeof location !== 'string') {
      return res.status(400).json({ message: 'Location must be a string' });
    }

    if (status && !['operational', 'maintenance', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Status must be one of: operational, maintenance, inactive' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description ? description.trim() : '';
    if (type !== undefined) updateData.type = type;
    if (location !== undefined) updateData.location = location;
    if (status !== undefined) updateData.status = status;

    const updatedInfrastructure = await Infrastructure.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json(updatedInfrastructure);
  } catch (error) {
    console.error('Update infrastructure error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/infrastructure/:id - Delete infrastructure
router.delete('/:id', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    // Delete all related data in order
    await ServiceUnit.deleteMany({ infrastructureId: req.params.id });
    await Zone.deleteMany({ infrastructureId: req.params.id });
    await ItemDetail.deleteMany({ itemId: { $in: await Item.find({ infrastructureId: req.params.id }).distinct('_id') } });
    await Entrance.deleteMany({ itemId: { $in: await Item.find({ infrastructureId: req.params.id }).distinct('_id') } });
    await Item.deleteMany({ infrastructureId: req.params.id });
    await Infrastructure.findByIdAndDelete(req.params.id);

    res.json({ message: 'Infrastructure deleted successfully' });
  } catch (error) {
    console.error('Delete infrastructure error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== SECTIONS & ITEMS ====================

// GET /api/infrastructure/:id/sections/:sectionType - Get items in section
router.get('/:id/sections/:sectionType', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { sectionType } = req.params;

    if (!['interior', 'exterior'].includes(sectionType)) {
      return res.status(400).json({ message: 'Invalid section type' });
    }

    const { page, limit, skip } = getPagination(req);
    const filter = {
      infrastructureId: req.params.id,
      sectionType
    };
    const total = await Item.countDocuments(filter);
    const items = await Item.find(filter)
      .populate('zoneId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get section items error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/infrastructure/:id/sections/:sectionType/items - Create item
router.post('/:id/sections/:sectionType/items', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { sectionType } = req.params;
    const { name, description, condition, quantity, zoneId } = req.body;

    if (!['interior', 'exterior'].includes(sectionType)) {
      return res.status(400).json({ message: 'Invalid section type' });
    }

    // Input validation
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
    }

    if (description && typeof description !== 'string') {
      return res.status(400).json({ message: 'Description must be a string' });
    }

    if (condition && !['excellent', 'good', 'fair', 'poor', 'damaged'].includes(condition)) {
      return res.status(400).json({ message: 'Condition must be one of: excellent, good, fair, poor, damaged' });
    }

    if (quantity !== undefined && (typeof quantity !== 'number' || quantity < 0)) {
      return res.status(400).json({ message: 'Quantity must be a non-negative number' });
    }

    const item = new Item({
      infrastructureId: req.params.id,
      sectionType,
      name: name.trim(),
      description: description ? description.trim() : '',
      condition: condition || 'good',
      quantity: quantity !== undefined ? quantity : 1,
      zoneId
    });

    await item.save();
    await item.populate('zoneId', 'name');

    res.status(201).json(item);
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/infrastructure/:id/sections/:sectionType/items/:itemId - Update item
router.put('/:id/sections/:sectionType/items/:itemId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { name, description, condition, quantity, zoneId } = req.body;

    // Verify item belongs to this infrastructure
    const item = await Item.findById(itemId);
    if (!item || item.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const updatedItem = await Item.findByIdAndUpdate(
      itemId,
      { name, description, condition, quantity, zoneId },
      { new: true, runValidators: true }
    ).populate('zoneId', 'name');

    res.json(updatedItem);
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/infrastructure/:id/sections/:sectionType/items/:itemId - Delete item
router.delete('/:id/sections/:sectionType/items/:itemId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { itemId } = req.params;

    // Verify item belongs to this infrastructure and delete related data
    const item = await Item.findById(itemId);
    if (!item || item.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Item not found' });
    }

    await ItemDetail.deleteMany({ itemId });
    await Entrance.deleteMany({ itemId });
    await Item.findByIdAndDelete(itemId);

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== ITEM DETAILS ====================

// GET /api/infrastructure/:id/items/:itemId - Get detailed item info
router.get('/:id/items/:itemId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { itemId } = req.params;

    // Verify item belongs to this infrastructure
    const item = await Item.findById(itemId).populate('zoneId', 'name');
    if (!item || item.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Get or create item details
    let itemDetail = await ItemDetail.findOne({ itemId });
    if (!itemDetail) {
      itemDetail = new ItemDetail({ itemId });
      await itemDetail.save();
    }

    // Get entrances
    const entrances = await Entrance.find({ itemId }).sort({ createdAt: -1 });

    res.json({
      item,
      details: itemDetail,
      entrances
    });
  } catch (error) {
    console.error('Get item detail error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/infrastructure/:id/items/:itemId - Update item details
router.put('/:id/items/:itemId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { totalCost, totalNumber, costOfMaintenance, lastInspected, nextInspectionDue, notes } = req.body;

    // Verify item belongs to this infrastructure
    const item = await Item.findById(itemId);
    if (!item || item.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Input validation
    if (totalCost !== undefined && (typeof totalCost !== 'number' || totalCost < 0)) {
      return res.status(400).json({ message: 'Total cost must be a non-negative number' });
    }

    if (totalNumber !== undefined && (typeof totalNumber !== 'number' || totalNumber < 0)) {
      return res.status(400).json({ message: 'Total number must be a non-negative number' });
    }

    if (costOfMaintenance !== undefined && (typeof costOfMaintenance !== 'number' || costOfMaintenance < 0)) {
      return res.status(400).json({ message: 'Cost of maintenance must be a non-negative number' });
    }

    if (lastInspected && !(lastInspected instanceof Date || !isNaN(Date.parse(lastInspected)))) {
      return res.status(400).json({ message: 'Last inspected must be a valid date' });
    }

    if (nextInspectionDue && !(nextInspectionDue instanceof Date || !isNaN(Date.parse(nextInspectionDue)))) {
      return res.status(400).json({ message: 'Next inspection due must be a valid date' });
    }

    if (notes && typeof notes !== 'string') {
      return res.status(400).json({ message: 'Notes must be a string' });
    }

    let itemDetail = await ItemDetail.findOne({ itemId });
    if (!itemDetail) {
      itemDetail = new ItemDetail({ itemId });
    }

    // Update fields
    if (totalCost !== undefined) itemDetail.totalCost = totalCost;
    if (totalNumber !== undefined) itemDetail.totalNumber = totalNumber;
    if (costOfMaintenance !== undefined) itemDetail.costOfMaintenance = costOfMaintenance;
    if (lastInspected !== undefined) itemDetail.lastInspected = lastInspected ? new Date(lastInspected) : null;
    if (nextInspectionDue !== undefined) itemDetail.nextInspectionDue = nextInspectionDue ? new Date(nextInspectionDue) : null;
    if (notes !== undefined) itemDetail.notes = notes ? notes.trim() : '';

    await itemDetail.save();

    res.json(itemDetail);
  } catch (error) {
    console.error('Update item detail error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== ENTRANCES ====================

// POST /api/infrastructure/:id/items/:itemId/entrances - Create entrance
router.post('/:id/items/:itemId/entrances', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { name, count, needsMaintenance, willNeedMaintenance, maintenanceDate, condition, hasEquipment, location } = req.body;

    // Verify item belongs to this infrastructure
    const item = await Item.findById(itemId);
    if (!item || item.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Input validation
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
    }

    if (count !== undefined && (typeof count !== 'number' || count < 0)) {
      return res.status(400).json({ message: 'Count must be a non-negative number' });
    }

    if (needsMaintenance !== undefined && typeof needsMaintenance !== 'boolean') {
      return res.status(400).json({ message: 'Needs maintenance must be a boolean' });
    }

    if (willNeedMaintenance !== undefined && typeof willNeedMaintenance !== 'boolean') {
      return res.status(400).json({ message: 'Will need maintenance must be a boolean' });
    }

    if (maintenanceDate && !(maintenanceDate instanceof Date || !isNaN(Date.parse(maintenanceDate)))) {
      return res.status(400).json({ message: 'Maintenance date must be a valid date' });
    }

    if (condition && !['excellent', 'good', 'fair', 'poor', 'damaged'].includes(condition)) {
      return res.status(400).json({ message: 'Condition must be one of: excellent, good, fair, poor, damaged' });
    }

    if (hasEquipment !== undefined && typeof hasEquipment !== 'boolean') {
      return res.status(400).json({ message: 'Has equipment must be a boolean' });
    }

    if (location && typeof location !== 'string') {
      return res.status(400).json({ message: 'Location must be a string' });
    }

    const entrance = new Entrance({
      itemId,
      name: name.trim(),
      count: count !== undefined ? count : 1,
      needsMaintenance: needsMaintenance !== undefined ? needsMaintenance : false,
      willNeedMaintenance: willNeedMaintenance !== undefined ? willNeedMaintenance : false,
      maintenanceDate: maintenanceDate ? new Date(maintenanceDate) : null,
      condition: condition || 'good',
      hasEquipment: hasEquipment !== undefined ? hasEquipment : false,
      location: location || ''
    });

    await entrance.save();
    res.status(201).json(entrance);
  } catch (error) {
    console.error('Create entrance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/infrastructure/:id/items/:itemId/entrances/:entranceId - Update entrance
router.put('/:id/items/:itemId/entrances/:entranceId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { entranceId } = req.params;
    const { name, count, needsMaintenance, willNeedMaintenance, maintenanceDate, condition, hasEquipment, location } = req.body;

    // Verify entrance belongs to item which belongs to infrastructure
    const entrance = await Entrance.findById(entranceId).populate({
      path: 'itemId',
      populate: { path: 'infrastructureId' }
    });

    if (!entrance || entrance.itemId.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Entrance not found' });
    }

    const updatedEntrance = await Entrance.findByIdAndUpdate(
      entranceId,
      { name, count, needsMaintenance, willNeedMaintenance, maintenanceDate, condition, hasEquipment, location },
      { new: true, runValidators: true }
    );

    res.json(updatedEntrance);
  } catch (error) {
    console.error('Update entrance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/infrastructure/:id/items/:itemId/entrances/:entranceId - Delete entrance
router.delete('/:id/items/:itemId/entrances/:entranceId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { entranceId } = req.params;

    // Verify entrance belongs to item which belongs to infrastructure
    const entrance = await Entrance.findById(entranceId).populate({
      path: 'itemId',
      populate: { path: 'infrastructureId' }
    });

    if (!entrance || entrance.itemId.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Entrance not found' });
    }

    await Entrance.findByIdAndDelete(entranceId);
    res.json({ message: 'Entrance deleted successfully' });
  } catch (error) {
    console.error('Delete entrance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== ZONES ====================

// GET /api/infrastructure/:id/zones - Get all zones
router.get('/:id/zones', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const filter = { infrastructureId: req.params.id };
    const total = await Zone.countDocuments(filter);
    const zones = await Zone.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: zones,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get zones error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/infrastructure/:id/zones - Create zone
router.post('/:id/zones', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { name, description, zoneType } = req.body;

    // Input validation
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
    }

    if (description && typeof description !== 'string') {
      return res.status(400).json({ message: 'Description must be a string' });
    }

    if (zoneType && typeof zoneType !== 'string') {
      return res.status(400).json({ message: 'Zone type must be a string' });
    }

    const zone = new Zone({
      infrastructureId: req.params.id,
      name: name.trim(),
      description: description ? description.trim() : '',
      zoneType: zoneType || 'general'
    });

    await zone.save();
    res.status(201).json(zone);
  } catch (error) {
    console.error('Create zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/infrastructure/:id/zones/:zoneId - Update zone
router.put('/:id/zones/:zoneId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { name, description, zoneType } = req.body;

    // Verify zone belongs to this infrastructure
    const zone = await Zone.findById(zoneId);
    if (!zone || zone.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Zone not found' });
    }

    const updatedZone = await Zone.findByIdAndUpdate(
      zoneId,
      { name, description, zoneType },
      { new: true, runValidators: true }
    );

    res.json(updatedZone);
  } catch (error) {
    console.error('Update zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/infrastructure/:id/zones/:zoneId - Delete zone
router.delete('/:id/zones/:zoneId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { zoneId } = req.params;

    // Verify zone belongs to this infrastructure
    const zone = await Zone.findById(zoneId);
    if (!zone || zone.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Zone not found' });
    }

    await Zone.findByIdAndDelete(zoneId);
    res.json({ message: 'Zone deleted successfully' });
  } catch (error) {
    console.error('Delete zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== SERVICE UNITS ====================

// GET /api/infrastructure/:id/service-units - Get all service units
router.get('/:id/service-units', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const filter = { infrastructureId: req.params.id };
    const total = await ServiceUnit.countDocuments(filter);
    const serviceUnits = await ServiceUnit.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: serviceUnits,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get service units error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/infrastructure/:id/service-units - Create service unit
router.post('/:id/service-units', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { name, description, serviceType, status } = req.body;

    // Input validation
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
    }

    if (description && typeof description !== 'string') {
      return res.status(400).json({ message: 'Description must be a string' });
    }

    if (serviceType && typeof serviceType !== 'string') {
      return res.status(400).json({ message: 'Service type must be a string' });
    }

    if (status && !['operational', 'maintenance', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Status must be one of: operational, maintenance, inactive' });
    }

    const serviceUnit = new ServiceUnit({
      infrastructureId: req.params.id,
      name: name.trim(),
      description: description ? description.trim() : '',
      serviceType: serviceType || 'general',
      status: status || 'operational'
    });

    await serviceUnit.save();
    res.status(201).json(serviceUnit);
  } catch (error) {
    console.error('Create service unit error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/infrastructure/:id/service-units/:unitId - Update service unit
router.put('/:id/service-units/:unitId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { unitId } = req.params;
    const { name, description, serviceType, status } = req.body;

    // Verify service unit belongs to this infrastructure
    const serviceUnit = await ServiceUnit.findById(unitId);
    if (!serviceUnit || serviceUnit.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Service unit not found' });
    }

    const updatedServiceUnit = await ServiceUnit.findByIdAndUpdate(
      unitId,
      { name, description, serviceType, status },
      { new: true, runValidators: true }
    );

    res.json(updatedServiceUnit);
  } catch (error) {
    console.error('Update service unit error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/infrastructure/:id/service-units/:unitId - Delete service unit
router.delete('/:id/service-units/:unitId', authenticateToken, ensureOwnership, async (req, res) => {
  try {
    const { unitId } = req.params;

    // Verify service unit belongs to this infrastructure
    const serviceUnit = await ServiceUnit.findById(unitId);
    if (!serviceUnit || serviceUnit.infrastructureId.toString() !== req.params.id) {
      return res.status(404).json({ message: 'Service unit not found' });
    }

    await ServiceUnit.findByIdAndDelete(unitId);
    res.json({ message: 'Service unit deleted successfully' });
  } catch (error) {
    console.error('Delete service unit error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;