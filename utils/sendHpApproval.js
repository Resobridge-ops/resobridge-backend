//sendHpApproval.js

require("dotenv").config();
const sendHpApproval = async (email, tempPassword) => {
  const SibApiV3Sdk = require("sib-api-v3-sdk");
  const client = SibApiV3Sdk.ApiClient.instance;
  const apiKey = client.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_API_KEY;

  const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

  const emailData = {
    sender: { email: "bolanlesadela@gmail.com", name: "ResoBridge" },
    to: [{ email }],
    subject: "Your Hall Porter Account Has Been Approved 🎉",
    htmlContent: `
      <p>Hi there,</p>
      <p>Your hall porter account on <strong>ResoBridge</strong> has been approved by the admin team.</p>
      <p>You can now login using:</p>
      <ul>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Password:</strong> ${tempPassword}</li>
      </ul>
      <p>We recommend changing your password after logging in.</p>
      <p>Welcome aboard!</p>
    `,
  };

  try {
    await tranEmailApi.sendTransacEmail(emailData);
    console.log("Approval email sent to", email);
  } catch (error) {
    console.error("Error sending approval email:", error.response?.data || error.message || error);
  }
};

module.exports = sendHpApproval;
