// utils/sendPorterNotification.js

require("dotenv").config();

const sendPorterNotification = async (
  porterEmail,
  hallName,
  complaintId,
  title,
  description,
  roomNumber
) => {
  const SibApiV3Sdk = require("sib-api-v3-sdk");
  const client = SibApiV3Sdk.ApiClient.instance;
  const apiKey = client.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_API_KEY;

  const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

  const emailData = {
    sender: { email: "bolanlesadela@gmail.com", name: "ResoBridge" },
    to: [{ email: porterEmail }],
    subject: `New Complaint in ${hallName} (ID: ${complaintId})`,
    htmlContent: `
      <h2>New Complaint Submitted</h2>
      <p><b>Hall:</b> ${hallName}</p>
      <p><b>Complaint ID:</b> ${complaintId}</p>
      <p><b>Title:</b> ${title}</p>
      <p><b>Description:</b> ${description}</p>
      <p><b>Room:</b> ${roomNumber}</p>
      <br/>
      <p>Please log in to the 
      <a href="https://your-resobridge-dashboard-link.com">ResoBridge dashboard</a> 
      to view full details and update status.</p>
    `,
  };

  try {
    await tranEmailApi.sendTransacEmail(emailData);
    console.log(`Porter notification sent to ${porterEmail}`);
  } catch (error) {
    console.error(
      "Error sending porter notification:",
      error.response?.data || error.message || error
    );
  }
};

module.exports = sendPorterNotification;
