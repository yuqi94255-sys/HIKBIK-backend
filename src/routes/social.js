const express = require('express');
const { toggleLike, toggleFollow, publishSocialPost } = require('../controllers/socialController');
const { verifyJWT } = require('../middleware/authMiddleware');
const { uploadCloud } = require('../middleware/cloudinaryConfig');

const router = express.Router();

/** 社群發佈（對齊 SocialPublishService） */
router.post('/publish', verifyJWT, publishSocialPost);

router.post('/toggle-like', verifyJWT, toggleLike);
router.post('/toggle-follow', verifyJWT, toggleFollow);

/**
 * POST /api/social/upload-image
 * multipart 欄位名：file（需 JWT）
 */
router.post('/upload-image', verifyJWT, uploadCloud.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: '請以 multipart/form-data 上傳欄位 file',
    });
  }
  return res.json({
    success: true,
    url: req.file.path,
  });
});

module.exports = router;