const QUICK_REPLIES = {
  student: [
    {
      text: "Submit Complaint",
      action: "complaint_submission",
      description: "Help with submitting a new complaint"
    },
    {
      text: "My Complaints",
      action: "view_complaints",
      description: "Check status of your complaints"
    },
    {
      text: "Navigation Help",
      action: "navigation_help",
      description: "Get help with using the platform"
    },
    {
      text: "Account Issues",
      action: "account_help",
      description: "Help with login, password, etc."
    },
    {
      text: "University Info",
      action: "university_info",
      description: "Learn about Covenant University"
    }
  ],
  
  hallporter: [
    {
      text: "View Requests",
      action: "view_requests",
      description: "Check student requests in your hall"
    },
    {
      text: "Update Status",
      action: "update_status",
      description: "Update complaint status"
    },
    {
      text: "Hall Information",
      action: "hall_info",
      description: "Get information about your hall"
    }
  ],
  
  admin: [
    {
      text: "System Analytics",
      action: "analytics",
      description: "View system statistics and reports"
    },
    {
      text: "Manage Users",
      action: "manage_users",
      description: "Approve or manage user accounts"
    },
    {
      text: "Resource Allocation",
      action: "resource_allocation",
      description: "Manage resource distribution"
    }
  ],
  
  general: [
    {
      text: "Hello",
      action: "greeting",
      description: "Start a conversation"
    },
    {
      text: "Help",
      action: "help",
      description: "Get general assistance"
    },
    {
      text: "About ResoBridge",
      action: "about",
      description: "Learn about the platform"
    }
  ]
};

function getQuickRepliesForRole(role) {
  const roleReplies = QUICK_REPLIES[role] || [];
  const generalReplies = QUICK_REPLIES.general;
  
  return [...roleReplies, ...generalReplies];
}

function getQuickReplyByAction(action) {
  for (const role in QUICK_REPLIES) {
    const reply = QUICK_REPLIES[role].find(r => r.action === action);
    if (reply) return reply;
  }
  return null;
}

module.exports = {
  QUICK_REPLIES,
  getQuickRepliesForRole,
  getQuickReplyByAction
};