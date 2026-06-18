const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const ChatMessage = require('../models/ChatMessage');
const ChatSession = require('../models/ChatSession');
const { getQuickRepliesForRole } = require('../utils/quickReplies');
const { generateAIResponse } = require('../utils/chatbotAI');

// Get chat history for a user
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const page = Number(req.query.page) >= 1 ? Math.floor(Number(req.query.page)) : 1;
    const limit = Number(req.query.limit) >= 1 ? Math.min(Math.floor(Number(req.query.limit)), 100) : 20;
    const skip = (page - 1) * limit;
    
    const session = await ChatSession.findOne({ userId }).sort({ updatedAt: -1 });
    
    if (!session) {
      const quickReplies = getQuickRepliesForRole(userRole);
      return res.json({ 
        data: [],
        page,
        limit,
        total: 0,
        totalPages: 0,
        quickReplies 
      });
    }

    const total = await ChatMessage.countDocuments({ sessionId: session._id });
    const messages = await ChatMessage.find({ sessionId: session._id })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit);

    const quickReplies = getQuickRepliesForRole(userRole);

    res.json({ 
      data: messages,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      quickReplies 
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Send a message to the chatbot
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Get or create chat session
    let session = await ChatSession.findOne({ userId });
    if (!session) {
      session = new ChatSession({ userId, userRole });
      await session.save();
    }

    // Save user message
    const userMessage = new ChatMessage({
      sessionId: session._id,
      sender: 'user',
      content: message.trim(),
      timestamp: new Date()
    });
    await userMessage.save();

    // Generate AI response
    const aiResponse = await generateAIResponse(message, userRole, userId);
    
    // Save AI response
    const aiMessage = new ChatMessage({
      sessionId: session._id,
      sender: 'ai',
      content: aiResponse,
      timestamp: new Date()
    });
    await aiMessage.save();

    // Update session
    session.lastMessage = message;
    session.updatedAt = new Date();
    await session.save();

    res.json({
      userMessage: userMessage,
      aiResponse: aiMessage
    });

  } catch (error) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Clear chat history
router.delete('/clear', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await ChatSession.findOne({ userId });
    
    if (session) {
      await ChatMessage.deleteMany({ sessionId: session._id });
      await ChatSession.findByIdAndDelete(session._id);
    }

    res.json({ message: 'Chat history cleared successfully' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// Get chatbot analytics (admin only)
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    const totalSessions = await ChatSession.countDocuments();
    const totalMessages = await ChatMessage.countDocuments();
    const activeSessions = await ChatSession.countDocuments({ isActive: true });
    
    // Get messages by sender type
    const userMessages = await ChatMessage.countDocuments({ sender: 'user' });
    const aiMessages = await ChatMessage.countDocuments({ sender: 'ai' });

    // Get recent activity
    const recentSessions = await ChatSession.find()
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate('userId', 'fullName email')
      .lean();

    res.json({
      totalSessions,
      totalMessages,
      activeSessions,
      userMessages,
      aiMessages,
      recentSessions
    });
  } catch (error) {
    console.error('Error fetching chatbot analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;