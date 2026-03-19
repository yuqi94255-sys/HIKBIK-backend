const express = require('express');
const {
  travelStays,
  travelFlights,
  travelCamps,
  travelParks,
  travelCars,
  shopPaymentIntent,
  shopSavedCards,
  shopRates,
  shopTrack,
  toolsUpload,
  toolsWeather,
} = require('../controllers/integrationController');

const router = express.Router();

// ---- Travel ----
router.get('/travel/stays', travelStays);
router.post('/travel/stays', travelStays);
router.get('/travel/flights', travelFlights);
router.post('/travel/flights', travelFlights);
router.get('/travel/camps', travelCamps);
router.post('/travel/camps', travelCamps);
router.get('/travel/parks', travelParks);
router.post('/travel/parks', travelParks);
router.get('/travel/cars', travelCars);
router.post('/travel/cars', travelCars);

// ---- Shop (支付 / 物流) ----
router.post('/shop/payment-intent', shopPaymentIntent);
router.get('/shop/cards', shopSavedCards);
router.get('/shop/rates', shopRates);
router.post('/shop/rates', shopRates);
router.get('/shop/track', shopTrack);
router.post('/shop/track', shopTrack);

// ---- Tools (媒體 / 天氣) ----
router.post('/tools/upload', toolsUpload);
router.get('/tools/weather', toolsWeather);
router.post('/tools/weather', toolsWeather);

module.exports = router;
