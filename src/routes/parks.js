const express = require('express');
const { getParks } = require('../controllers/parksController');

const router = express.Router();

router.get('/parks', getParks);

module.exports = router;
