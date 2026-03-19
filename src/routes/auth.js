const express = require('express');
const {
  googleLogin,
  appleLogin,
  register,
  login,
  me,
  sendOTP,
  verifyOTP,
  checkEmail,
} = require('../controllers/authController');
const { verifyJWT } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/check-email', checkEmail);
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/send-code', sendOTP);
router.post('/verify-code', verifyOTP);
router.post('/google', googleLogin);
router.post('/apple', appleLogin);
router.post('/register', register);
router.post('/login', login);
router.get('/me', verifyJWT, me);

module.exports = router;
