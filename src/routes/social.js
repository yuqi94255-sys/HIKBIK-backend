const express = require('express');
const socialController = require('../controllers/socialController');
const { verifyJWT, optionalVerifyJWT } = require('../middleware/authMiddleware');
const { uploadCloud } = require('../middleware/cloudinaryConfig');

const router = express.Router();

/** 社群廣場卡片流（可選 JWT：帶 Token 時回傳 isLiked） */
router.get('/feed', optionalVerifyJWT, socialController.getFeed);

/** 個人貼文 / 已讚貼文（須 JWT；須在 /:id 動態路由之前） */
router.get('/me/posts', verifyJWT, socialController.getMyPosts);
router.get('/me/liked-posts', verifyJWT, socialController.getLikedPosts);

/** 社群發佈（對齊 SocialPublishService） */
router.post('/publish', verifyJWT, socialController.publishSocialPost);

/** 貼文互動（綁定當前用戶）— 須在 /:id/* 之前保留字面路徑 */
router.post('/:id/like', verifyJWT, socialController.togglePostLike);
router.post('/:id/comment/:commentId/like', verifyJWT, socialController.toggleCommentLike);
router.post('/:id/comment', verifyJWT, socialController.addPostComment);

router.post('/toggle-like', verifyJWT, socialController.toggleLike);
router.post('/toggle-follow', verifyJWT, socialController.toggleFollow);

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
