const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/emailService');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '30d' });
};

// REGISTER
const registerUser = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    // Check if user already exists
    const userExists = await User.findByEmail(email);
    if (userExists) return res.status(400).json({ msg: 'User already exists' });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.createUser(name, email, hashedPassword);

    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      stage: user.stage,
      onboarding_completed: user.onboarding_completed,
      token: generateToken(user.id),
      message: "Registration successful. Please complete your onboarding."
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// LOGIN
const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findByEmail(email);
    if (!user) return res.status(400).json({ msg: 'Invalid Credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid Credentials' });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      stage: user.stage,
      onboarding_completed: user.onboarding_completed,
      profile_data: user.profile_data,
      token: generateToken(user.id),
      message: user.onboarding_completed ? "Login successful" : "Please complete your onboarding"
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// FORGOT PASSWORD
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findByEmail(email);
    if (!user) return res.status(404).json({ msg: "User not found" });

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    await User.setOtp(email, otp);

    const sent = await sendEmail(email, "Password Reset Code", `Your OTP is: ${otp}. Valid for 10 minutes.`);
    if (sent) {
      res.json({
        msg: "OTP sent to your email",
        email: email
      });
    } else {
      res.status(500).json({ msg: "Email sending failed" });
    }

  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// VERIFY OTP
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const user = await User.verifyOtp(email, otp);

    if (!user) {
      return res.status(400).json({ msg: "Invalid or expired OTP" });
    }

    res.json({
      msg: "OTP verified successfully",
      verified: true
    });
  } catch (err) {
    console.error("OTP verification error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// RESET PASSWORD
const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  try {
    const user = await User.verifyOtp(email, otp);
    if (!user) return res.status(400).json({ msg: "Invalid or expired OTP" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await User.resetPassword(email, hashedPassword);

    res.json({ msg: "Password updated successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

module.exports = { registerUser, loginUser, forgotPassword, verifyOtp, resetPassword };