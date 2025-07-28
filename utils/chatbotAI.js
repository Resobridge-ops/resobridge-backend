const Complaint = require('../models/Complaint');
const ComplaintType = require('../models/ComplaintType');
const Hall = require('../models/Hall');
const User = require('../models/User');

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

  university_info: [
    'covenant', 'university', 'school', 'campus', 'faculty', 'department',
    'academic', 'student life', 'admission', 'courses'
  ]
};

// University information database
const UNIVERSITY_INFO = {
  general: {
    name: "Covenant University",
    location: "Ota, Ogun State, Nigeria",
    founded: "2002",
    type: "Private Christian University",
    motto: "Raising a New Generation of Leaders"
  },
  
  academics: {
    faculties: [
      "College of Business and Social Sciences",
      "College of Engineering",
      "College of Leadership and Development Studies",
      "College of Science and Technology"
    ],
    programs: "Undergraduate and Postgraduate programs",
    accreditation: "Fully accredited by NUC"
  },

  campus_life: {
    housing: "On-campus accommodation for all students",
    facilities: "Modern facilities including library, sports complex, and technology centers",
    activities: "Various student organizations and activities"
  },

  contact: {
    phone: "+234-1-4542070",
    email: "info@covenantuniversity.edu.ng",
    website: "www.covenantuniversity.edu.ng"
  }
};

// Response templates
const RESPONSES = {
  greetings: [
    "Hello! 👋 I'm your ResoBridge AI Assistant. How can I help you today?",
    "Hi there! 😊 Welcome to ResoBridge. What can I assist you with?",
    "Greetings! 🌟 I'm here to help with any questions about ResoBridge or Covenant University."
  ],

  farewells: [
    "Goodbye! 👋 Have a great day!",
    "See you later! 😊 Feel free to come back if you need more help.",
    "Take care! 🌟 Don't hesitate to reach out if you have more questions."
  ],

  complaint_guidance: [
    "To submit a complaint, go to the 'Submit Complaint' section. You'll need to provide details like room number, issue description, and select the appropriate category.",
    "For complaint submission, navigate to the complaints page and fill out the form with your issue details, room number, and category.",
    "Submit complaints through the main dashboard. Make sure to include your room number and a clear description of the issue."
  ],

  resource_help: [
    "Resource allocation requests are handled by administrators. Contact your hall porter or admin for resource-related issues.",
    "For resource requests, please speak with your hall porter or contact the administration office.",
    "Resource allocation is managed by the admin team. Reach out to your hall porter for assistance."
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

  university_info: [
    `Covenant University is a private Christian university located in Ota, Ogun State, Nigeria. Founded in 2002, it's known for its commitment to raising leaders and academic excellence.`,
    `CU offers various programs across multiple colleges including Business, Engineering, Leadership, and Science & Technology. The university provides on-campus accommodation and modern facilities.`,
    `Covenant University is accredited by NUC and offers both undergraduate and postgraduate programs. The campus includes modern facilities and a vibrant student life.`
  ],

  default: [
    "I'm not sure I understand. Could you please rephrase your question?",
    "I'm here to help with ResoBridge and Covenant University questions. Could you be more specific?",
    "Let me know if you need help with complaints, resources, navigation, or general university information."
  ]
};

// Main AI response generator
async function generateAIResponse(userMessage, userRole, userId) {
  const message = userMessage.toLowerCase().trim();
  
  // Check for greetings
  if (KNOWLEDGE_BASE.greetings.some(greeting => message.includes(greeting))) {
    return getRandomResponse(RESPONSES.greetings);
  }

  // Check for farewells
  if (KNOWLEDGE_BASE.farewells.some(farewell => message.includes(farewell))) {
    return getRandomResponse(RESPONSES.farewells);
  }

  // Check for complaint-related queries
  if (KNOWLEDGE_BASE.complaint_related.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.complaint_guidance);
  }

  // Check for resource-related queries
  if (KNOWLEDGE_BASE.resource_related.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.resource_help);
  }

  // Check for navigation help
  if (KNOWLEDGE_BASE.navigation_help.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.navigation_help);
  }

  // Check for account help
  if (KNOWLEDGE_BASE.account_help.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.account_help);
  }

  // Check for university information
  if (KNOWLEDGE_BASE.university_info.some(term => message.includes(term))) {
    return getRandomResponse(RESPONSES.university_info);
  }

  // Role-specific responses
  if (userRole === 'student') {
    return generateStudentSpecificResponse(message, userId);
  }

  // Default response
  return getRandomResponse(RESPONSES.default);
}

// Generate student-specific responses
async function generateStudentSpecificResponse(message, userId) {
  try {
    // Check if user has existing complaints
    const userComplaints = await Complaint.find({ userId }).countDocuments();
    
    if (message.includes('my complaint') || message.includes('my complaints')) {
      if (userComplaints === 0) {
        return "You haven't submitted any complaints yet. You can submit a new complaint through the dashboard.";
      } else {
        return `You have ${userComplaints} complaint(s) in the system. Check your dashboard to view their status.`;
      }
    }

    if (message.includes('complaint status') || message.includes('status')) {
      const pendingComplaints = await Complaint.find({ userId, status: 'Pending' }).countDocuments();
      const resolvedComplaints = await Complaint.find({ userId, status: 'Resolved' }).countDocuments();
      
      return `You have ${pendingComplaints} pending complaint(s) and ${resolvedComplaints} resolved complaint(s). Check your dashboard for details.`;
    }

    return getRandomResponse(RESPONSES.default);
  } catch (error) {
    console.error('Error generating student-specific response:', error);
    return getRandomResponse(RESPONSES.default);
  }
}

// Helper function to get random response from array
function getRandomResponse(responses) {
  return responses[Math.floor(Math.random() * responses.length)];
}

// Get university information by category
function getUniversityInfo(category) {
  return UNIVERSITY_INFO[category] || UNIVERSITY_INFO.general;
}

module.exports = {
  generateAIResponse,
  getUniversityInfo,
  KNOWLEDGE_BASE,
  UNIVERSITY_INFO
};