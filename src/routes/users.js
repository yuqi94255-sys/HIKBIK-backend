const express = require('express');
const { getProfile, updateProfile, uploadAvatar, getPublicProfile, followUser } = require('../controllers/userController');
const { verifyJWT } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadAvatar');

const router = express.Router();

router.get('/me', verifyJWT, getProfile);
router.patch('/me', verifyJWT, updateProfile);
/** 與 PATCH /me 相同邏輯；專供前端只更新頭像 URL（avatarUrl，小駝峰） */
router.patch('/profile', verifyJWT, updateProfile);
router.post('/avatar', verifyJWT, upload.single('avatar'), uploadAvatar);
router.get('/:id', getPublicProfile);
router.post('/:id/follow', verifyJWT, followUser);

module.exports = router;
