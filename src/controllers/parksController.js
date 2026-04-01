const axios = require('axios');
const mongoose = require('mongoose');
const NodeCache = require('node-cache');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');
const ParkCoverOverride = require('../models/ParkCoverOverride');

const NPS_PARKS_URL = 'https://developer.nps.gov/api/v1/parks';
const PAGE_SIZE = 50;
const TARGET_TOTAL = 100;
const CACHE_TTL_SEC = 900;
const parksCache = new NodeCache({ stdTTL: CACHE_TTL_SEC });
const NPS_CACHE_KEY = 'nps:parks:100:images';

function isUnsplashUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return (
    u.includes('unsplash.com') ||
    u.includes('images.unsplash') ||
    u.includes('source.unsplash') ||
    u.includes('unsplash.it')
  );
}

function mapPark(p) {
  if (!p || typeof p !== 'object') return null;
  const images = Array.isArray(p.images) ? p.images : [];
  const coverUrl = images[0]?.url ?? null;
  return keysToSnakeCase({
    id: p.id != null ? String(p.id) : null,
    parkCode: p.parkCode != null ? String(p.parkCode) : '',
    fullName: p.fullName ?? '',
    description: p.description ?? '',
    coverImage: coverUrl,
  });
}

function mergeParkPages(pages) {
  const byId = new Map();
  for (const list of pages) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || item.id == null) continue;
      const id = String(item.id);
      if (!byId.has(id)) byId.set(id, item);
    }
  }
  return Array.from(byId.values());
}

async function fetchNpsPage(apiKey, start) {
  return axios.get(NPS_PARKS_URL, {
    params: {
      limit: PAGE_SIZE,
      start,
      fields: 'images',
    },
    headers: {
      'X-Api-Key': apiKey.trim(),
    },
    timeout: 20000,
    validateStatus: () => true,
  });
}

function assertNpsOk(npsRes, res) {
  const { status, data } = npsRes;
  if (status === 401 || status === 403) {
    fail(res, 'NPS API 金鑰無效或無權限', 502);
    return false;
  }
  if (status < 200 || status >= 300) {
    const msg =
      (data && typeof data === 'object' && (data.message || data.error)) ||
      `NPS API HTTP ${status}`;
    fail(res, typeof msg === 'string' ? msg : 'NPS API 請求失敗', 502);
    return false;
  }
  if (data == null || typeof data !== 'object') {
    fail(res, 'NPS API 回應異常', 502);
    return false;
  }
  if (data.error) {
    fail(res, typeof data.error === 'string' ? data.error : 'NPS API 錯誤', 502);
    return false;
  }
  return true;
}

async function loadParkCoverOverridesMap() {
  try {
    if (mongoose.connection.readyState !== 1) return new Map();
    const rows = await ParkCoverOverride.find({}).select('park_code cover_image').lean();
    const m = new Map();
    for (const r of rows) {
      if (!r.park_code || !r.cover_image) continue;
      m.set(String(r.park_code).toLowerCase(), String(r.cover_image).trim());
    }
    return m;
  } catch (err) {
    console.warn('loadParkCoverOverridesMap:', err.message);
    return new Map();
  }
}

/**
 * 禁止對外回傳 Unsplash；Mongo 覆寫優先（官方種子 URL）
 */
function finalizeParkCover(park, overridesMap) {
  const code = (park.park_code || '').toLowerCase();
  let url = park.cover_image;
  if (isUnsplashUrl(url)) url = null;

  const override = overridesMap.get(code);
  if (override && !isUnsplashUrl(override)) {
    url = override;
  }

  return { ...park, cover_image: url };
}

async function applyOverridesToParks(parks) {
  const overridesMap = await loadParkCoverOverridesMap();
  return parks.map((p) => finalizeParkCover(p, overridesMap));
}

function clearParksNpsCache() {
  parksCache.del(NPS_CACHE_KEY);
}

/**
 * GET /api/parks — 代理 NPS（最多 100 筆）、Mongo 封面覆寫、封鎖 Unsplash cover_image
 */
async function getParks(req, res) {
  const apiKey = process.env.NPS_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return fail(res, 'NPS_API_KEY 未設定', 503);
  }

  try {
    let baseParks = parksCache.get(NPS_CACHE_KEY);
    if (!baseParks) {
      const [first, second] = await Promise.all([
        fetchNpsPage(apiKey, 0),
        fetchNpsPage(apiKey, PAGE_SIZE),
      ]);

      if (!assertNpsOk(first, res)) return;
      if (!assertNpsOk(second, res)) return;

      const rawMerged = mergeParkPages([first.data.data, second.data.data]).slice(0, TARGET_TOTAL);
      baseParks = rawMerged.map(mapPark).filter(Boolean);
      parksCache.set(NPS_CACHE_KEY, baseParks);
    }

    const parks = await applyOverridesToParks(baseParks);
    const payload = { parks, total: parks.length };
    return ok(res, payload);
  } catch (err) {
    const status = err.response?.status;
    const msg =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      '取得公園資料失敗';
    console.error('getParks NPS error:', status, msg);
    return fail(res, status === 401 || status === 403 ? 'NPS API 金鑰無效或無權限' : msg, 502);
  }
}

module.exports = { getParks, clearParksNpsCache };
