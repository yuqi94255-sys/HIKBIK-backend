const express = require('express');
const { toggleLike, toggleFollow } = require('../controllers/socialController');
const { verifyJWT } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/toggle-like', verifyJWT, toggleLike);
router.post('/toggle-follow', verifyJWT, toggleFollow);

module.exports = router;