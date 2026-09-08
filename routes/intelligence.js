const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const ResoBridgeIntelligence = require('../utils/resobridgeIntelligence');
const { authenticate, authorizeRoles } = require('../middleware/authenticate');

const intelligence = new ResoBridgeIntelligence();

router.use(authenticate, authorizeRoles('ORG_ADMIN', 'ADMIN'));

// A missing AdminScope row must fail closed (403), not be treated as
// unrestricted — same distinction as authorizeDepartment in
// middleware/authenticate.js: only an AdminScope that *explicitly* has an
// empty departmentIds array means "all departments in the org."
router.use((req, res, next) => {
  if (req.user.role === 'ADMIN' && !req.user.adminScope) {
    return res.status(403).json({ success: false, message: 'No admin scope configured for this account.' });
  }
  next();
});

// ADMIN is restricted to their AdminScope.departmentIds (empty = all
// departments in the org); ORG_ADMIN is unrestricted within their org.
// The old version queried Complaint/Hall globally with no org filter at
// all — that was a cross-tenant leak, not a stylistic gap, fixed here.
function complaintScope(req) {
  const { role, organizationId, adminScope } = req.user;
  const where = { organizationId };
  if (role === 'ADMIN') {
    const scopedIds = adminScope.departmentIds || [];
    if (scopedIds.length > 0) where.departmentId = { in: scopedIds };
  }
  return where;
}

// Get comprehensive intelligence analysis
router.get('/analysis', async (req, res) => {
  try {
    const { timeRange = 30 } = req.query;

    const complaints = await prisma.complaint.findMany({
      where: complaintScope(req),
      include: { category: true, area: { include: { building: true } }, member: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const buildings = await prisma.building.findMany({ where: { organizationId: req.user.organizationId } });

    const analysis = await intelligence.generateComprehensiveAnalysis(complaints, buildings, parseInt(timeRange));

    if (!analysis.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate intelligence analysis',
        error: analysis.error,
      });
    }

    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('Intelligence analysis error:', error);
    res.status(500).json({ success: false, message: 'Server error during intelligence analysis' });
  }
});

// Get category trend analysis
router.get('/trends', async (req, res) => {
  try {
    const { timeRange = 30 } = req.query;

    const complaints = await prisma.complaint.findMany({
      where: complaintScope(req),
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });

    const trends = await intelligence.analyzeCategoryTrends(complaints, parseInt(timeRange));

    res.json({ success: true, data: trends });
  } catch (error) {
    console.error('Trend analysis error:', error);
    res.status(500).json({ success: false, message: 'Server error during trend analysis' });
  }
});

// Get infrastructure weak points
router.get('/weak-points', async (req, res) => {
  try {
    const complaints = await prisma.complaint.findMany({
      where: complaintScope(req),
      include: { category: true, area: { include: { building: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const buildings = await prisma.building.findMany({ where: { organizationId: req.user.organizationId } });

    const weakPoints = await intelligence.analyzeInfrastructureWeakPoints(complaints, buildings);

    res.json({ success: true, data: weakPoints });
  } catch (error) {
    console.error('Weak points analysis error:', error);
    res.status(500).json({ success: false, message: 'Server error during weak points analysis' });
  }
});

// Get AI-powered summary
router.get('/summary', async (req, res) => {
  try {
    const complaints = await prisma.complaint.findMany({
      where: complaintScope(req),
      include: { category: true, area: { include: { building: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const analyticsData = {
      totalComplaints: complaints.length,
      resolved: complaints.filter(c => c.status === 'RESOLVED').length,
      resolutionRate: complaints.length > 0
        ? Math.round((complaints.filter(c => c.status === 'RESOLVED').length / complaints.length) * 100)
        : 0,
      topCategories: [],
      trends: [],
    };

    const trends = await intelligence.analyzeCategoryTrends(complaints, 30);
    analyticsData.trends = trends.trends || [];
    analyticsData.topCategories = trends.trends?.slice(0, 5) || [];

    const summary = await intelligence.generateAnalyticsSummary(analyticsData);

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ success: false, message: 'Server error during summary generation' });
  }
});

module.exports = router;
