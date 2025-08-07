require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendResetPasswordEmail = async (email, resetLink) => {
  const client = SibApiV3Sdk.ApiClient.instance;
  const apiKey = client.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_API_KEY;

  const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

  const emailData = {
    sender: { email: "bolanlesadela@gmail.com", name: "ResoBridge" },
    to: [{ email }],
    subject: "Reset Your ResoBridge Password 🔐",
    htmlContent: `
      <p>Hey there,</p>
      <p>We got a request to reset your password on <strong>ResoBridge</strong>.</p>
      <p>Click the link below to set a new password. This link will expire in 10 minutes:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>If you didn’t ask for a password reset, you can ignore this email.</p>
      <p>Stay secure,<br/>ResoBridge Team</p>
    `,
  };

  try {
    await tranEmailApi.sendTransacEmail(emailData);
    console.log("Reset password email sent to", email);
  } catch (error) {
    console.error("Error sending reset password email:", error.response?.data || error.message || error);
  }
};

module.exports = sendResetPasswordEmail;
