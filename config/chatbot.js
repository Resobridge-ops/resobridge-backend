module.exports = {
  // Chatbot settings
  settings: {
    maxMessageLength: 500,
    responseTimeout: 10000, // 10 seconds
    maxHistoryLength: 50, // Maximum messages to keep in history
    autoClearInactiveSessions: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  },

  // Content filtering
  contentFilter: {
    enabled: true,
    blockedWords: [
      'spam', 'hack', 'attack', 'exploit', 'vulnerability',
      'admin', 'root', 'sudo', 'password', 'token'
    ],
    maxRequestsPerMinute: 30
  },

  // Role-based access control
  roleAccess: {
    student: {
      canViewOwnComplaints: true,
      canSubmitComplaints: true,
      canViewUniversityInfo: true,
      canAccessChatbot: true
    },
    hallporter: {
      canViewHallComplaints: true,
      canUpdateComplaintStatus: true,
      canViewHallInfo: true,
      canAccessChatbot: true
    },
    admin: {
      canViewAllComplaints: true,
      canManageUsers: true,
      canViewAnalytics: true,
      canAccessChatbot: true
    },
    superadmin: {
      canViewAllComplaints: true,
      canManageUsers: true,
      canViewAnalytics: true,
      canManageAdmins: true,
      canAccessChatbot: true
    }
  },

  // Response templates for different scenarios
  responses: {
    rateLimitExceeded: "I'm receiving too many messages right now. Please wait a moment and try again.",
    contentFiltered: "I can't process that message. Please rephrase your question.",
    sessionExpired: "Your chat session has expired. Please refresh the page to start a new conversation.",
    unauthorized: "You don't have permission to access this feature.",
    error: "Sorry, I encountered an error. Please try again later."
  }
};