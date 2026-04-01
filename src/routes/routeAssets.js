const express = require('express');
const {
  uploadRoute,
  publishRoute,
  getFeed,
  getJourneyById,
} = require('../controllers/routeController');
const { listOfficialRoutes, getOfficialRouteById } = require('../controllers/officialRoutesController');
const { verifyJWT } = require('../middleware/authMiddleware');
const reviewsRouter = require('./reviews');

const router = express.Router();

router.get('/feed', getFeed);
/** Journey/Route 詳情（公開，暫不做本人限制） */
router.get('/journeys/:id', getJourneyById);
router.get('/feed/:id', getJourneyById);
router.get('/detail/:id', getJourneyById);
router.get('/', listOfficialRoutes);
router.get('/:id', getOfficialRouteById);
router.post('/upload', verifyJWT, uploadRoute);
router.post('/publish', verifyJWT, publishRoute);
router.use('/:id/reviews', reviewsRouter);

module.exports = router;
