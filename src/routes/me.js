const express = require('express');
const {
  getDestinations,
  toggleDestinations,
  getLiked,
  getSaved,
} = require('../controllers/meController');

const router = express.Router();
// 所有 /api/me 路由由 server 掛載時套用 verifyJWT

router.get('/destinations', getDestinations);
router.post('/destinations', toggleDestinations);
router.get('/liked', getLiked);
router.get('/saved', getSaved);

module.exports = router;