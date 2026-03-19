const { INVENTORY } = require('../models/inventory');

/**
 * GET 全球資產 - 站點單車租賃數據
 */
function getInventory(req, res) {
  res.json({
    success: true,
    region: 'San Francisco',
    stations: INVENTORY,
  });
}

module.exports = {
  getInventory,
};
