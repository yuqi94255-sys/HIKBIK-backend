const express = require('express');
const { getProfile, updateProfile, getPublicProfile, followUser } = require('../controllers/userController');
const { verifyJWT } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/me', verifyJWT, getProfile);
router.patch('/me', verifyJWT, updateProfile);
router.get('/:id', getPublicProfile);
router.post('/:id/follow', verifyJWT, followUser);

module.exports = router;
