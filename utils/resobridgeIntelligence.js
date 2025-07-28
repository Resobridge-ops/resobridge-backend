const axios = require('axios');
const moment = require('moment');
const _ = require('lodash');

class ResoBridgeIntelligence {
  constructor() {
    // NVIDIA NIM API Configuration
    this.nimBaseUrl = process.env.NVIDIA_NIM_BASE_URL || 'https://api.nvcf.nvidia.com';
    this.nimApiKey = process.env.NVIDIA_NIM_API_KEY;
    this.modelName = process.env.NVIDIA_MODEL_NAME || 'llama3-8b-instruct';
  }

  // Category Trend Analysis
  async analyzeCategoryTrends(complaints, timeRange = 30) {
    try {
      const now = moment();
      const pastDate = moment().subtract(timeRange, 'days');
      
      // Group complaints by category and time period
      const categoryData = {};
      
      complaints.forEach(complaint => {
        const complaintDate = moment(complaint.createdAt);
        const category = complaint.complaintTypeId?.name || 'Unknown';
        
        if (!categoryData[category]) {
          categoryData[category] = {
            current: 0,
            previous: 0,
            total: 0
          };
        }
        
        categoryData[category].total++;
        
        // Split into current and previous periods
        if (complaintDate.isAfter(pastDate)) {
          categoryData[category].current++;
        } else {
          categoryData[category].previous++;
        }
      });

      // Calculate trends
      const trends = [];
      for (const [category, data] of Object.entries(categoryData)) {
        const currentRate = data.current / (timeRange / 2);
        const previousRate = data.previous / (timeRange / 2);
        const changePercent = previousRate > 0 ? ((currentRate - previousRate) / previousRate) * 100 : 0;
        
        trends.push({
          category,
          currentCount: data.current,
          previousCount: data.previous,
          changePercent: Math.round(changePercent * 100) / 100,
          trend: changePercent > 10 ? 'rising' : changePercent < -10 ? 'falling' : 'stable',
          priority: Math.abs(changePercent)
        });
      }

      // Sort by priority (highest change first)
      trends.sort((a, b) => b.priority - a.priority);

      return {
        success: true,
        trends,
        timeRange,
        totalComplaints: complaints.length
      };
    } catch (error) {
      console.error('Category trend analysis error:', error);
      return { success: false, error: error.message };
    }
  }

  // Infrastructure Weak Point Discovery
  async analyzeInfrastructureWeakPoints(complaints, halls) {
    try {
      const weakPoints = [];
      
      // Group complaints by hall and category
      const hallComplaints = {};
      
      complaints.forEach(complaint => {
        const hallId = complaint.hallId?._id || complaint.hallId;
        const category = complaint.complaintTypeId?.name || 'Unknown';
        
        if (!hallComplaints[hallId]) {
          hallComplaints[hallId] = {};
        }
        
        if (!hallComplaints[hallId][category]) {
          hallComplaints[hallId][category] = 0;
        }
        
        hallComplaints[hallId][category]++;
      });

      // Find halls with high complaint volumes for specific categories
      for (const [hallId, categories] of Object.entries(hallComplaints)) {
        const hall = halls.find(h => h._id.toString() === hallId);
        const hallName = hall?.name || `Hall ${hallId}`;
        
        for (const [category, count] of Object.entries(categories)) {
          if (count >= 3) { // Threshold for weak point detection
            weakPoints.push({
              hallId,
              hallName,
              category,
              complaintCount: count,
              severity: count >= 5 ? 'high' : count >= 3 ? 'medium' : 'low',
              recommendation: this.generateInfrastructureRecommendation(category, hallName, count)
            });
          }
        }
      }

      // Sort by severity and count
      weakPoints.sort((a, b) => {
        const severityOrder = { high: 3, medium: 2, low: 1 };
        return severityOrder[b.severity] - severityOrder[a.severity] || b.complaintCount - a.complaintCount;
      });

      return {
        success: true,
        weakPoints,
        totalWeakPoints: weakPoints.length
      };
    } catch (error) {
      console.error('Infrastructure weak point analysis error:', error);
      return { success: false, error: error.message };
    }
  }

  // Generate infrastructure recommendations
  generateInfrastructureRecommendation(category, hallName, count) {
    const recommendations = {
      'Maintenance': `Consider upgrading maintenance systems in ${hallName}. High volume suggests systemic issues.`,
      'Security': `Review security protocols in ${hallName}. Consider additional security measures.`,
      'Water': `Water system in ${hallName} may need inspection. Consider plumbing upgrades.`,
      'Electrical': `Electrical systems in ${hallName} require attention. Schedule safety inspection.`,
      'Cleaning': `Increase cleaning frequency in ${hallName}. Consider hiring additional staff.`,
      'Noise': `Implement noise reduction measures in ${hallName}. Consider soundproofing.`,
      'Internet': `Upgrade internet infrastructure in ${hallName}. Consider network optimization.`
    };

    return recommendations[category] || `Investigate ${category} issues in ${hallName}. ${count} complaints indicate systemic problems.`;
  }

  // LLM-powered Analytics Summary
  async generateAnalyticsSummary(analyticsData) {
    try {
      if (!this.nimApiKey) {
        // Fallback to rule-based summary if no API key
        return this.generateFallbackSummary(analyticsData);
      }

      const prompt = `
        Analyze this complaint analytics data and provide a 2-line summary with actionable insights:
        
        Total Complaints: ${analyticsData.totalComplaints}
        Resolved: ${analyticsData.resolved}
        Resolution Rate: ${analyticsData.resolutionRate}%
        Top Categories: ${analyticsData.topCategories.map(c => `${c.category}: ${c.count}`).join(', ')}
        Recent Trends: ${analyticsData.trends?.slice(0, 3).map(t => `${t.category}: ${t.changePercent}%`).join(', ')}
        
        Provide a concise 2-line summary focusing on key insights and actionable recommendations.
      `;

      const response = await axios.post(`${this.nimBaseUrl}/v1/chat/completions`, {
        model: this.modelName,
        messages: [
          {
            role: "system",
            content: "You are ResoBridge Intelligence, an AI assistant that analyzes complaint data and provides actionable insights. Be concise and practical."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 150,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${this.nimApiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const summary = response.data.choices[0].message.content.trim();
      
      return {
        success: true,
        summary,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('LLM summary generation error:', error);
      // Fallback to rule-based summary
      return this.generateFallbackSummary(analyticsData);
    }
  }

  // Fallback summary when LLM is not available
  generateFallbackSummary(analyticsData) {
    const resolutionRate = analyticsData.resolutionRate || 0;
    const totalComplaints = analyticsData.totalComplaints || 0;
    const resolved = analyticsData.resolved || 0;
    
    let summary = "";
    
    if (resolutionRate >= 80) {
      summary = `Excellent performance with ${resolutionRate}% resolution rate. `;
    } else if (resolutionRate >= 60) {
      summary = `Good performance with ${resolutionRate}% resolution rate. `;
    } else {
      summary = `Resolution rate of ${resolutionRate}% needs improvement. `;
    }

    if (totalComplaints > 0) {
      const pending = totalComplaints - resolved;
      if (pending > 0) {
        summary += `Focus on resolving ${pending} pending complaints to improve overall performance.`;
      } else {
        summary += `All complaints have been resolved. Maintain this high standard.`;
      }
    }

    return {
      success: true,
      summary,
      generatedAt: new Date().toISOString(),
      method: 'rule-based'
    };
  }

  // Comprehensive Intelligence Analysis
  async generateComprehensiveAnalysis(complaints, halls, timeRange = 30) {
    try {
      // Get all analyses
      const categoryTrends = await this.analyzeCategoryTrends(complaints, timeRange);
      const weakPoints = await this.analyzeInfrastructureWeakPoints(complaints, halls);
      
      // Prepare analytics data for summary
      const analyticsData = {
        totalComplaints: complaints.length,
        resolved: complaints.filter(c => c.status === 'Resolved').length,
        resolutionRate: Math.round((complaints.filter(c => c.status === 'Resolved').length / complaints.length) * 100),
        topCategories: categoryTrends.trends?.slice(0, 5) || [],
        trends: categoryTrends.trends || []
      };

      const summary = await this.generateAnalyticsSummary(analyticsData);

      return {
        success: true,
        categoryTrends,
        weakPoints,
        summary,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Comprehensive analysis error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ResoBridgeIntelligence; 