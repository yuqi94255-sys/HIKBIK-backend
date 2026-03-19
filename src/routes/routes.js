const express = require('express');
const { postTestPath } = require('../controllers/routesController');

const router = express.Router();

// 路徑引擎：GPS 經緯度
router.post('/test-path', postTestPath);

module.exports = router;
