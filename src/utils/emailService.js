const axios = require('axios');
require('dotenv').config();

const sendEmail = async (to, subject, htmlContent) => {
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: "AI Counsellor", email: process.env.SENDER_EMAIL }, // Must be verified in Brevo
        to: [{ email: to }],
        subject: subject,
        htmlContent: htmlContent,
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        }
      }
    );
    console.log(`📧 Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error("❌ Email Failed:", error.response?.data || error.message);
    return false;
  }
};

module.exports = sendEmail;