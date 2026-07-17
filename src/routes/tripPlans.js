const express = require('express');
const {
  listTripPlans,
  upsertTripPlan,
  getTripPlan,
  patchTripPlan,
  deleteTripPlan,
} = require('../controllers/tripPlansController');

const router = express.Router();
// 所有 /api/trips 路由由 server 掛載時套用 verifyJWT（綁 userId）

router.get('/', listTripPlans);
router.post('/', upsertTripPlan);
router.get('/:id', getTripPlan);
router.patch('/:id', patchTripPlan);
router.delete('/:id', deleteTripPlan);

module.exports = router;
