require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendOTP = async (email, otp) => {
    const client = SibApiV3Sdk.ApiClient.instance;
    const apiKey = client.authentications["api-key"];
    apiKey.apiKey = process.env.BREVO_API_KEY;

    const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
    
    const emailData = {
        sender: { email: "bolanlesadela@gmail.com", name: "ResoBridge" }, // Change this if needed
        to: [{ email: email }],
        subject: "Your OTP Code for ResoBridge",
        htmlContent: `<p>Your One-Time Password (OTP) is: <strong>${otp}</strong></p><p>Do not share this code with anyone.</p>`,
    };

    try {
        await tranEmailApi.sendTransacEmail(emailData);
        console.log("OTP sent successfully to", email);
    } catch (error) {
        console.error("Error sending OTP:", error.response?.data || error.message || error);

    }
};

module.exports = sendOTP;
