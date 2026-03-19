const express = require('express');
const { getInventory } = require('../controllers/productsController');

const router = express.Router();

// 全球資產：站點庫存
router.get('/inventory', getInventory);

module.exports = router;
