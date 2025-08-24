// sendComplaintReceipt.js

require("dotenv").config();
const axios = require("axios");

const sendComplaintReceipt = async (studentEmail, complaintTitle, complaintId) => {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;

  const emailData = {
    sender: { email: "bolanlesadela@gmail.com", name: "ResoBridge" },
    to: [{ email: studentEmail }],
    subject: "Complaint Received ✅",
    htmlContent: `
      <p>Hi there,</p>
      <p>Your complaint has been received on <strong>ResoBridge</strong>.</p>
      <p><strong>Title:</strong> ${complaintTitle}</p>
      <p><strong>Reference ID:</strong> ${complaintId}</p>
      <p>Our team will review your complaint and keep you updated.</p>
      <p>Thank you for helping us improve your campus experience.</p>
    `,
  };

  try {
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      emailData,
      {
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Complaint receipt email sent to", studentEmail);
  } catch (error) {
    console.error(
      "Error sending complaint receipt email:",
      error.response?.data || error.message || error
    );
  }
};

module.exports = sendComplaintReceipt;
