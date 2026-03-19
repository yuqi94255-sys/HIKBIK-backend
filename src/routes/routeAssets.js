const express = require('express');
const { uploadRoute, publishRoute, getFeed } = require('../controllers/routeController');
const { listOfficialRoutes, getOfficialRouteById } = require('../controllers/officialRoutesController');
const { verifyJWT } = require('../middleware/authMiddleware');
const reviewsRouter = require('./reviews');

const router = express.Router();

router.get('/feed', getFeed);
router.get('/', listOfficialRoutes);
router.get('/:id', getOfficialRouteById);
router.post('/upload', verifyJWT, uploadRoute);
router.post('/publish', verifyJWT, publishRoute);
router.use('/:id/reviews', reviewsRouter);

module.exports = router;
