const travelService = require('../services/travelService');
const paymentService = require('../services/paymentService');
const shippingService = require('../services/shippingService');
const mediaService = require('../services/mediaService');
const weatherService = require('../services/weatherService');
const { ok, fail } = require('../utils/response');

/** Travel：民宿 / 機票 / 營地 */
async function travelStays(req, res) {
  try {
    const params = { ...req.query, ...req.body };
    const data = await travelService.searchStays(params);
    return ok(res, data);
  } catch (err) {
    const status = Number(err.status) || 503;
    return fail(res, err.message || 'travel 服務錯誤', status);
  }
}

async function travelFlights(req, res) {
  try {
    const params = { ...req.query, ...req.body };
    const data = await travelService.searchFlights(params);
    return ok(res, data);
  } catch (err) {
    const status = Number(err.status) || 503;
    return fail(res, err.message || 'travel 服務錯誤', status);
  }
}

async function travelCamps(req, res) {
  try {
    const params = { ...req.query, ...req.body };
    const data = await travelService.searchCamps(params);
    return ok(res, data);
  } catch (err) {
    const status = Number(err.status) || 503;
    return fail(res, err.message || 'travel 服務錯誤', status);
  }
}

async function travelParks(req, res) {
  try {
    const params = { ...req.query, ...req.body };
    const data = await travelService.searchParks(params);
    return ok(res, data);
  } catch (err) {
    const status = Number(err.status) || 503;
    return fail(res, err.message || 'travel 服務錯誤', status);
  }
}

async function travelCars(req, res) {
  try {
    const params = { ...req.query, ...req.body };
    const data = await travelService.searchCars(params);
    return ok(res, data);
  } catch (err) {
    const status = Number(err.status) || 503;
    return fail(res, err.message || 'travel 服務錯誤', status);
  }
}

/** Shop：支付 / 運費 / 追蹤 */
async function shopPaymentIntent(req, res) {
  try {
    const params = { ...req.body };
    const data = await paymentService.createPaymentIntent(params);
    return ok(res, data);
  } catch (err) {
    return fail(res, err.message || 'payment 服務錯誤', err.status || 503);
  }
}

async function shopSavedCards(req, res) {
  try {
    const userId = req.query?.user_id ?? req.user?.id;
    const data = await paymentService.getSavedCards(userId);
    return ok(res, data);
  } catch (err) {
    return fail(res, err.message || 'payment 服務錯誤', err.status || 503);
  }
}

async function shopRates(req, res) {
  try {
    const params = { ...req.query, ...req.body };
    const data = await shippingService.getRates(params);
    return ok(res, data);
  } catch (err) {
    return fail(res, err.message || 'shipping 服務錯誤', err.status || 503);
  }
}

async function shopTrack(req, res) {
  try {
    const trackingNumber = req.query?.tracking_number ?? req.body?.tracking_number;
    const data = await shippingService.trackPackage(trackingNumber);
    return ok(res, data);
  } catch (err) {
    return fail(res, err.message || 'shipping 服務錯誤', err.status || 503);
  }
}

/** Tools：媒體上傳（Buffer / Base64 -> Cloudinary hikbik_uploads） */
async function toolsUpload(req, res) {
  try {
    const file = req.file?.buffer || req.body?.file || req.body?.image_base64 || req.body?.image;
    const options = {
      folder: req.body?.folder,
      public_id: req.body?.public_id,
    };
    const data = await mediaService.uploadImage(file, options);
    return ok(res, data);
  } catch (err) {
    const status = Number(err.status) || 503;
    const message = err.message || '媒體上傳失敗';
    return fail(res, message, status);
  }
}

/** Tools：天氣查詢（OpenWeather，lat/lon） */
async function toolsWeather(req, res) {
  try {
    const lat = req.query?.lat ?? req.body?.lat;
    const lon = req.query?.lon ?? req.body?.lon;
    if (lat == null || lon == null) {
      return fail(res, '請提供 lat 與 lon 參數', 400);
    }
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      return fail(res, 'lat、lon 須為數字', 400);
    }
    const data = await weatherService.getWeather(latNum, lonNum);
    return ok(res, data);
  } catch (err) {
    const status = Number(err.status) || 503;
    const message = err.message || '天氣服務暫時不可用';
    return fail(res, message, status);
  }
}

module.exports = {
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
};
