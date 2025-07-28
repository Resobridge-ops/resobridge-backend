const express = require('express');
const router = express.Router();
const ResoBridgeIntelligence = require('../utils/resobridgeIntelligence');
const Complaint = require('../models/Complaint');
const Hall = require('../models/Hall');
const { authenticateToken } = require('../middleware/auth');

const intelligence = new ResoBridgeIntelligence();

// Get comprehensive intelligence analysis
router.get('/analysis', authenticateToken, async (req, res) => {
  try {
    const { timeRange = 30 } = req.query;
    
    // Fetch complaints with populated data
    const complaints = await Complaint.find()
      .populate('complaintTypeId', 'name')
      .populate('hallId', 'name')
      .populate('userId', 'fullName')
      .sort({ createdAt: -1 });

    // Fetch all halls
    const halls = await Hall.find();

    // Generate comprehensive analysis
    const analysis = await intelligence.generateComprehensiveAnalysis(
      complaints, 
      halls, 
      parseInt(timeRange)
    );

    if (!analysis.success) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to generate intelligence analysis',
        error: analysis.error 
      });
    }

    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Intelligence analysis error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during intelligence analysis' 
    });
  }
});

// Get category trend analysis
router.get('/trends', authenticateToken, async (req, res) => {
  try {
    const { timeRange = 30 } = req.query;
    
    const complaints = await Complaint.find()
      .populate('complaintTypeId', 'name')
      .sort({ createdAt: -1 });

    const trends = await intelligence.analyzeCategoryTrends(complaints, parseInt(timeRange));

    res.json({
      success: true,
      data: trends
    });

  } catch (error) {
    console.error('Trend analysis error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during trend analysis' 
    });
  }
});

// Get infrastructure weak points
router.get('/weak-points', authenticateToken, async (req, res) => {
  try {
    const complaints = await Complaint.find()
      .populate('complaintTypeId', 'name')
      .populate('hallId', 'name')
      .sort({ createdAt: -1 });

    const halls = await Hall.find();

    const weakPoints = await intelligence.analyzeInfrastructureWeakPoints(complaints, halls);

    res.json({
      success: true,
      data: weakPoints
    });

  } catch (error) {
    console.error('Weak points analysis error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during weak points analysis' 
    });
  }
});

// Get AI-powered summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const complaints = await Complaint.find()
      .populate('complaintTypeId', 'name')
      .populate('hallId', 'name')
      .sort({ createdAt: -1 });

    const halls = await Hall.find();

    // Prepare analytics data
    const analyticsData = {
      totalComplaints: complaints.length,
      resolved: complaints.filter(c => c.status === 'Resolved').length,
      resolutionRate: complaints.length > 0 ? 
        Math.round((complaints.filter(c => c.status === 'Resolved').length / complaints.length) * 100) : 0,
      topCategories: [],
      trends: []
    };

    // Get category trends for summary
    const trends = await intelligence.analyzeCategoryTrends(complaints, 30);
    analyticsData.trends = trends.trends || [];
    analyticsData.topCategories = trends.trends?.slice(0, 5) || [];

    const summary = await intelligence.generateAnalyticsSummary(analyticsData);

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during summary generation' 
    });
  }
});

module.exports = router; 