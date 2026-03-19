const express = require('express');
const {
  listByRoute,
  create,
  getOne,
  update,
  remove,
} = require('../controllers/reviewController');
const { verifyJWT } = require('../middleware/authMiddleware');

const router = express.Router({ mergeParams: true });
// 父路徑為 /api/routes/:id/reviews

router.get('/', listByRoute);
router.post('/', verifyJWT, create);
router.get('/:reviewId', getOne);
router.patch('/:reviewId', verifyJWT, update);
router.delete('/:reviewId', verifyJWT, remove);

module.exports = router;
