// utils/sendEmail.js
// Consolidated Brevo transactional email functions. Standardized on the
// axios + Brevo REST API pattern (per ARCHITECTURE.md), replacing the
// mixed sib-api-v3-sdk / axios usage across the old per-purpose files.

require("dotenv").config();
const axios = require("axios");

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const SENDER = {
  email: process.env.BREVO_SENDER_EMAIL || "noreply@resobridge.app",
  name: "ResoBridge",
};

// Every OTP, temp password, and invitation link in this file only ever
// reaches the developer through a real inbox — there is no other way to
// see them. That's fine in production, but it's a hard QA blocker
// locally: without Brevo configured (or with a throwaway/unreachable
// test address), these values are simply lost, and every single
// non-SUPERADMIN onboarding path depends on one of them. This does not
// weaken anything — it surfaces a value that was already being
// transmitted, to the person who already has the server console — and
// it's off entirely once NODE_ENV=production.
const ECHO_TO_CONSOLE = process.env.NODE_ENV !== "production";

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendBrevoEmail({ to, subject, htmlContent }) {
  if (ECHO_TO_CONSOLE) {
    console.log(
      `\n── DEV EMAIL ECHO (NODE_ENV != production) ─────────────\nTo: ${to}\nSubject: ${subject}\n\n${stripHtml(htmlContent)}\n──────────────────────────────────────────────────────────\n`
    );
  }
  try {
    await axios.post(
      BREVO_API_URL,
      {
        sender: SENDER,
        to: [{ email: to }],
        subject,
        htmlContent,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`Email "${subject}" sent to ${to}`);
  } catch (error) {
    console.error(`Error sending email "${subject}" to ${to}:`, error.response?.data || error.message || error);
  }
}

async function sendOtpEmail(email, otp) {
  return sendBrevoEmail({
    to: email,
    subject: "Your OTP Code for ResoBridge",
    htmlContent: `<p>Your One-Time Password (OTP) is: <strong>${otp}</strong></p><p>Do not share this code with anyone.</p>`,
  });
}

async function sendPasswordResetEmail(email, resetLink) {
  return sendBrevoEmail({
    to: email,
    subject: "Reset Your ResoBridge Password",
    htmlContent: `
      <p>Hey there,</p>
      <p>We got a request to reset your password on <strong>ResoBridge</strong>.</p>
      <p>Click the link below to set a new password. This link will expire in 10 minutes:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>If you didn't ask for a password reset, you can ignore this email.</p>
      <p>Stay secure,<br/>ResoBridge Team</p>
    `,
  });
}

async function sendComplaintReceiptEmail(memberEmail, complaintTitle, complaintId) {
  return sendBrevoEmail({
    to: memberEmail,
    subject: "Request Received",
    htmlContent: `
      <p>Hi there,</p>
      <p>Your request has been received on <strong>ResoBridge</strong>.</p>
      <p><strong>Title:</strong> ${complaintTitle}</p>
      <p><strong>Reference ID:</strong> ${complaintId}</p>
      <p>Our team will review your request and keep you updated.</p>
    `,
  });
}

// Staff account approved and credentials issued (was hall-porter specific).
async function sendStaffApprovalEmail(email, tempPassword) {
  return sendBrevoEmail({
    to: email,
    subject: "Your ResoBridge Staff Account Has Been Approved",
    htmlContent: `
      <p>Hi there,</p>
      <p>Your staff account on <strong>ResoBridge</strong> has been approved by the admin team.</p>
      <p>You can now log in using:</p>
      <ul>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Password:</strong> ${tempPassword}</li>
      </ul>
      <p>We recommend changing your password after logging in.</p>
      <p>Welcome aboard!</p>
    `,
  });
}

async function sendAdminAccountEmail(email, fullName, tempPassword) {
  return sendBrevoEmail({
    to: email,
    subject: "Your ResoBridge Org Admin Account",
    htmlContent: `
      <p>Hi ${fullName || "there"},</p>
      <p>You have been added as an <strong>Org Admin</strong> on <strong>ResoBridge</strong>.</p>
      <p>Please log in using the following credentials:</p>
      <ul>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Temporary Password:</strong> ${tempPassword}</li>
      </ul>
      <p>You'll be required to change your password on first login.</p>
      <p>Welcome aboard!</p>
    `,
  });
}

// A department's assigned staff member is notified of a new request
// (was sendPorterNotification, keyed on hallName/roomNumber).
async function sendComplaintAssignmentEmail(staffEmail, departmentName, complaintId, title, description, location) {
  const dashboardUrl = process.env.FRONTEND_URL || "https://resobridge-dashboard.netlify.app";
  return sendBrevoEmail({
    to: staffEmail,
    subject: `New Request in ${departmentName} (ID: ${complaintId})`,
    htmlContent: `
      <h2>New Request Submitted</h2>
      <p><b>Department:</b> ${departmentName}</p>
      <p><b>Request ID:</b> ${complaintId}</p>
      <p><b>Title:</b> ${title}</p>
      <p><b>Description:</b> ${description}</p>
      ${location ? `<p><b>Location:</b> ${location}</p>` : ""}
      <br/>
      <p>Please log in to the <a href="${dashboardUrl}">ResoBridge dashboard</a> to view full details and update status.</p>
    `,
  });
}

// New: needed for the Invitation flow (ORG_ADMIN/DEPT_ADMIN inviting a
// specific person into an organization) — no equivalent existed in the old
// codebase.
async function sendInvitationEmail(email, organizationName, role, acceptLink) {
  return sendBrevoEmail({
    to: email,
    subject: `You've been invited to join ${organizationName} on ResoBridge`,
    htmlContent: `
      <p>Hi there,</p>
      <p>You've been invited to join <strong>${organizationName}</strong> on <strong>ResoBridge</strong> as <strong>${role}</strong>.</p>
      <p>Click the link below to accept the invitation and set up your account. This link will expire in 7 days:</p>
      <p><a href="${acceptLink}">${acceptLink}</a></p>
    `,
  });
}

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendComplaintReceiptEmail,
  sendStaffApprovalEmail,
  sendAdminAccountEmail,
  sendComplaintAssignmentEmail,
  sendInvitationEmail,
};
