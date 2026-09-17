const prisma = require("../prisma/client");

// Knowledge base for the chatbot
const KNOWLEDGE_BASE = {
  greetings: [
    'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
    'howdy', 'greetings', 'sup', 'yo'
  ],

  farewells: [
    'bye', 'goodbye', 'see you', 'farewell', 'take care', 'later',
    'good night', 'have a good day'
  ],

  complaint_related: [
    'complaint', 'submit', 'report', 'issue', 'problem', 'broken',
    'maintenance', 'repair', 'fix', 'damage'
  ],

  resource_related: [
    'resource', 'allocation', 'request', 'equipment', 'tools', 'materials',
    'supplies', 'inventory'
  ],

  navigation_help: [
    'help', 'how to', 'where', 'navigate', 'menu', 'dashboard',
    'find', 'locate', 'search'
  ],

  account_help: [
    'account', 'profile', 'login', 'password', 'reset', 'register',
    'sign up', 'sign in', 'logout'
  ],

  // Was university_info with a hardcoded Covenant University knowledge base.
  // The platform is multi-tenant, so this can no longer be static content —
  // it now resolves the caller's actual Organization record instead.
  organization_info: [
    'organization', 'organisation', 'company', 'workplace', 'department',
    'about this platform', 'who runs this', 'admission', 'courses'
  ]
};

// Response templates
const RESPONSES = {
  greetings: [
    "Hello! 👋 I'm your ResoBridge AI Assistant. How can I help you today?",
    "Hi there! 😊 Welcome to ResoBridge. What can I assist you with?",
    "Greetings! 🌟 I'm here to help with any questions about ResoBridge."
  ],

  farewells: [
    "Goodbye! 👋 Have a great day!",
    "See you later! 😊 Feel free to come back if you need more help.",
    "Take care! 🌟 Don't hesitate to reach out if you have more questions."
  ],

  complaint_guidance: [
    "To submit a complaint, go to the 'Submit Complaint' section. You'll need to provide details like location, issue description, and select the appropriate category.",
    "For complaint submission, navigate to the complaints page and fill out the form with your issue details, location, and category.",
    "Submit complaints through the main dashboard. Make sure to include the location and a clear description of the issue."
  ],

  resource_help: [
    "Resource allocation requests are handled by administrators. Contact your department staff or admin for resource-related issues.",
    "For resource requests, please speak with your department staff or contact the administration office.",
    "Resource allocation is managed by the admin team. Reach out to your department for assistance."
  ],

  navigation_help: [
    "Use the navigation menu to access different sections. The dashboard shows your complaints and notifications.",
    "Navigate using the sidebar menu. Your dashboard displays your complaints and recent activities.",
    "Check the main menu for different sections. Your dashboard has all your personal information and complaints."
  ],

  account_help: [
    "For account issues, use the 'Forgot Password' feature or contact support. Make sure to use your registered email.",
    "Account problems can be resolved through the login page options or by contacting the support team.",
    "Use the password reset feature if you can't log in, or contact the admin for account assistance."
  ],

  default: [
    "I'm not sure I understand. Could you please rephrase your question?",
    "I'm here to help with ResoBridge questions. Could you be more specific?",
    "Let me know if you need help with complaints, resources, navigation, or your organization."
  ]
};

// Main AI response generator
async function generateAIResponse(userMessage, userRole, userId, organizationId) {
  const message = userMessage.toLowerCase().trim();

  if (KNOWLEDGE_BASE.greetings.some(greeting => message.includes(greeting))) {
    return getRandomResponse(RESPONSES.greetings);
  }

  if (KNOWLEDGE_BASE.farewells.some(farewell => message.includes(farewell))) {
    return getRandomResponse(RESPONSES.farewells);
  }

  if (KNOWLEDGE_BASE.complaint_related.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.complaint_guidance);
  }

  if (KNOWLEDGE_BASE.resource_related.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.resource_help);
  }

  if (KNOWLEDGE_BASE.navigation_help.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.navigation_help);
  }

  if (KNOWLEDGE_BASE.account_help.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.account_help);
  }

  if (KNOWLEDGE_BASE.organization_info.some(term => message.includes(term))) {
    return generateOrganizationInfoResponse(organizationId);
  }

  if (userRole === 'REQUESTER') {
    return generateMemberSpecificResponse(message, userId, organizationId);
  }

  return getRandomResponse(RESPONSES.default);
}

async function generateOrganizationInfoResponse(organizationId) {
  try {
    if (!organizationId) return getRandomResponse(RESPONSES.default);
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) return getRandomResponse(RESPONSES.default);
    return `You're using ResoBridge for ${organization.name}. For more details, contact your organization admin.`;
  } catch (error) {
    console.error('Error generating organization info response:', error);
    return getRandomResponse(RESPONSES.default);
  }
}

// Generate REQUESTER-specific responses (was generateStudentSpecificResponse)
async function generateMemberSpecificResponse(message, userId, organizationId) {
  try {
    if (message.includes('my complaint') || message.includes('my complaints')) {
      const userComplaints = await prisma.complaint.count({ where: { memberId: userId, organizationId } });
      if (userComplaints === 0) {
        return "You haven't submitted any complaints yet. You can submit a new complaint through the dashboard.";
      }
      return `You have ${userComplaints} complaint(s) in the system. Check your dashboard to view their status.`;
    }

    if (message.includes('complaint status') || message.includes('status')) {
      const [pendingComplaints, resolvedComplaints] = await Promise.all([
        prisma.complaint.count({ where: { memberId: userId, organizationId, status: 'PENDING' } }),
        prisma.complaint.count({ where: { memberId: userId, organizationId, status: 'RESOLVED' } }),
      ]);

      return `You have ${pendingComplaints} pending complaint(s) and ${resolvedComplaints} resolved complaint(s). Check your dashboard for details.`;
    }

    return getRandomResponse(RESPONSES.default);
  } catch (error) {
    console.error('Error generating member-specific response:', error);
    return getRandomResponse(RESPONSES.default);
  }
}

// Helper function to get random response from array
function getRandomResponse(responses) {
  return responses[Math.floor(Math.random() * responses.length)];
}

module.exports = {
  generateAIResponse,
  KNOWLEDGE_BASE
};
