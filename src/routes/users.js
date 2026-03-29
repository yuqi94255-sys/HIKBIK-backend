const express = require('express');
const {
  getProfile,
  updateProfile,
  uploadAvatar,
  getPublicProfile,
  getUserProfile,
  getUserFollowing,
  followUser,
} = require('../controllers/userController');
const { verifyJWT, optionalVerifyJWT } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadAvatar');

const router = express.Router();

router.get('/me', verifyJWT, getProfile);
router.patch('/me', verifyJWT, updateProfile);
/** 與 PATCH /me 相同邏輯；專供前端只更新頭像 URL（avatarUrl，小駝峰） */
router.patch('/profile', verifyJWT, updateProfile);
router.post('/avatar', verifyJWT, upload.single('avatar'), uploadAvatar);
/** 社交檔案（可選 JWT → isFollowing） */
router.get('/:id/profile', optionalVerifyJWT, getUserProfile);
/** 關注列表（populate 暱稱與頭像） */
router.get('/:id/following', getUserFollowing);
router.get('/:id', getPublicProfile);
router.post('/:id/follow', verifyJWT, followUser);

module.exports = router;
