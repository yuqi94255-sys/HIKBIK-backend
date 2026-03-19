const express = require('express');
const { getComments, createComment } = require('../controllers/commentsController');
const { verifyJWT } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/:id/comments', getComments);
router.post('/:id/comments', verifyJWT, createComment);

module.exports = router;