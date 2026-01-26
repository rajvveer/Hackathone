const User = require('../models/userModel'); // Import the Model
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
    // Uses Model instead of raw SQL
    const userExists = await User.findByEmail(email);
    if (userExists) return res.status(400).json({ msg: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Uses Model
    const user = await User.createUser(name, email, hashedPassword);

    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      stage: user.stage,
      token: generateToken(user.id)
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// LOGIN
const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findByEmail(email); // Uses Model
    if (!user) return res.status(400).json({ msg: 'Invalid Credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid Credentials' });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      stage: user.stage,
      token: generateToken(user.id)
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// FORGOT PASSWORD
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findByEmail(email); // Uses Model
    if (!user) return res.status(404).json({ msg: "User not found" });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    await User.setOtp(email, otp); // Uses Model

    const sent = await sendEmail(email, "Reset Code", `Your OTP is: ${otp}`);
    if (sent) res.json({ msg: "OTP sent" });
    else res.status(500).json({ msg: "Email failed" });

  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// RESET PASSWORD
const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  try {
    const user = await User.findByEmail(email); // Uses Model
    if (!user || user.otp !== otp) return res.status(400).json({ msg: "Invalid OTP" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await User.resetPassword(email, hashedPassword); // Uses Model

    res.json({ msg: "Password updated" });
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

module.exports = { registerUser, loginUser, forgotPassword, resetPassword };