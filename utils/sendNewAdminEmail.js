require("dotenv").config();

const sendNewAdminEmail = async (email, fullName, tempPassword) => {
  const SibApiV3Sdk = require("sib-api-v3-sdk");
  const client = SibApiV3Sdk.ApiClient.instance;
  const apiKey = client.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_API_KEY;

  const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

  const emailData = {
    sender: { email: "bolanlesadela@gmail.com", name: "ResoBridge" },
    to: [{ email }],
    subject: "Your ResoBridge Admin Account 🎉",
    htmlContent: `
      <p>Hi ${fullName || 'there'},</p>
      <p>You have been added as an <strong>Admin</strong> on <strong>ResoBridge</strong> by the Super Admin.</p>
      <p>Please log in using the following credentials:</p>
      <ul>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Temporary Password:</strong> ${tempPassword}</li>
      </ul>
      <p>You’ll be required to change your password on first login.</p>
      <p>Welcome aboard!</p>
    `,
  };

  try {
    await tranEmailApi.sendTransacEmail(emailData);
    console.log("Admin account creation email sent to", email);
  } catch (error) {
    console.error("Error sending new admin email:", error.response?.data || error.message || error);
  }
};

module.exports = sendNewAdminEmail;
