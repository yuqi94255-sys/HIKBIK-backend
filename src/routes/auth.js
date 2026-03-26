const express = require('express');
const {
  googleLogin,
  appleLogin,
  register,
  login,
  sendOTP,
  verifyOTP,
  checkEmail,
} = require('../controllers/authController');
const { verifyJWT } = require('../middleware/authMiddleware');
const { updateProfile } = require('../controllers/userController');

const router = express.Router();

// ---------------------------------------------------------------------------
// 公開路由（不需 JWT；Header 有無 Bearer 都會進入處理函數）
// ---------------------------------------------------------------------------
router.get('/check-email', checkEmail);
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/send-code', sendOTP);
router.post('/verify-code', verifyOTP);
router.post('/google', googleLogin);
router.post('/apple', appleLogin);
router.post('/register', register);
/** Email 密碼登入：完全公開，不掛 verifyJWT / protect，僅比對 body 內 email + password */
router.post('/login', login);

// 舊路徑棄用：統一導向 /api/users/me（避免兩套資料接口）
router.get('/me', (req, res) => {
  return res.redirect(308, '/api/users/me');
});
router.patch('/me', (req, res) => {
  return res.redirect(308, '/api/users/me');
});

/** PATCH body 會隨請求轉發；與 /api/users/profile 相同（updateProfile + profilePayload） */
router.patch('/profile', verifyJWT, updateProfile);

module.exports = router;
