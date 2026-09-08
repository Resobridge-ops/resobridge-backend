const express = require('express');
const router = express.Router();
const prisma = require('../prisma/client');
const { authenticate, authorizeRoles } = require('../middleware/authenticate');
const { getQuickRepliesForRole } = require('../utils/quickReplies');
const { generateAIResponse } = require('../utils/chatbotAI');

router.use(authenticate);

// Get chat history for a user
router.get('/history', async (req, res) => {
  try {
    const { id: userId, organizationId, role } = req.user;
    const session = await prisma.chatSession.findFirst({
      where: { userId, organizationId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!session) {
      const quickReplies = getQuickRepliesForRole(role);
      return res.json({ messages: [], quickReplies });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });

    const quickReplies = getQuickRepliesForRole(role);

    res.json({ messages, quickReplies });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Send a message to the chatbot
router.post('/send', async (req, res) => {
  try {
    const { message } = req.body;
    const { id: userId, organizationId, role } = req.user;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    let session = await prisma.chatSession.findFirst({ where: { userId, organizationId } });
    if (!session) {
      session = await prisma.chatSession.create({ data: { userId, organizationId, userRole: role } });
    }

    const userMessage = await prisma.chatMessage.create({
      data: { sessionId: session.id, sender: 'user', content: message.trim() },
    });

    const aiResponse = await generateAIResponse(message, role, userId, organizationId);

    const aiMessage = await prisma.chatMessage.create({
      data: { sessionId: session.id, sender: 'ai', content: aiResponse },
    });

    await prisma.chatSession.update({
      where: { id: session.id },
      data: { lastMessage: message, messageCount: { increment: 1 } },
    });

    res.json({ userMessage, aiResponse: aiMessage });
  } catch (error) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Clear chat history
router.delete('/clear', async (req, res) => {
  try {
    const { id: userId, organizationId } = req.user;
    const session = await prisma.chatSession.findFirst({ where: { userId, organizationId } });

    if (session) {
      await prisma.chatMessage.deleteMany({ where: { sessionId: session.id } });
      await prisma.chatSession.delete({ where: { id: session.id } });
    }

    res.json({ message: 'Chat history cleared successfully' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// Get chatbot analytics (ORG_ADMIN / SUPERADMIN only)
router.get('/analytics', authorizeRoles('ORG_ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    const { organizationId } = req.user;
    const where = { organizationId };

    const [totalSessions, totalMessages, activeSessions, userMessages, aiMessages, recentSessions] = await Promise.all([
      prisma.chatSession.count({ where }),
      prisma.chatMessage.count({ where: { session: { organizationId } } }),
      prisma.chatSession.count({ where: { ...where, isActive: true } }),
      prisma.chatMessage.count({ where: { sender: 'user', session: { organizationId } } }),
      prisma.chatMessage.count({ where: { sender: 'ai', session: { organizationId } } }),
      prisma.chatSession.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: { user: { select: { fullName: true, email: true } } },
      }),
    ]);

    res.json({
      totalSessions,
      totalMessages,
      activeSessions,
      userMessages,
      aiMessages,
      recentSessions,
    });
  } catch (error) {
    console.error('Error fetching chatbot analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
