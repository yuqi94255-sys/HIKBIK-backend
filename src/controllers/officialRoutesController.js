const NodeCache = require('node-cache');
const OfficialRoute = require('../models/OfficialRoute');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');

const ROUTE_CACHE_TTL = 3600;
const officialRoutesCache = new NodeCache({ stdTTL: ROUTE_CACHE_TTL });

function toSnakePayload(doc) {
  if (!doc) return null;
  const raw = doc.toObject ? doc.toObject() : doc;
  const out = {
    id: raw._id?.toString?.() ?? raw.id,
    title: raw.title,
    subtitle: raw.subtitle,
    cover_image: raw.cover_image,
    difficulty: raw.difficulty,
    distance_km: raw.distance_km,
    duration_hours: raw.duration_hours,
    elevation_gain: raw.elevation_gain,
    gpx_data: raw.gpx_data,
    waypoints: raw.waypoints,
    description: raw.description,
    equipment_tips: raw.equipment_tips,
    tags: raw.tags,
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
  };
  return keysToSnakeCase(out);
}

/**
 * GET /api/routes — 官方路線列表（分頁 + 難度篩選）
 */
async function listOfficialRoutes(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const difficulty = (req.query.difficulty || '').trim();
    const cacheKey = `official_routes:list:${page}:${limit}:${difficulty}`;

    let data = officialRoutesCache.get(cacheKey);
    if (data) return ok(res, data);

    const filter = {};
    if (difficulty && ['Easy', 'Moderate', 'Hard'].includes(difficulty)) {
      filter.difficulty = difficulty;
    }

    const [list, total] = await Promise.all([
      OfficialRoute.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      OfficialRoute.countDocuments(filter),
    ]);

    const items = list.map((doc) => toSnakePayload({ ...doc, toObject: () => doc }));
    data = {
      items,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
    officialRoutesCache.set(cacheKey, data);
    return ok(res, data);
  } catch (err) {
    console.error('listOfficialRoutes error:', err);
    return fail(res, '取得路線列表失敗', 500);
  }
}

/**
 * GET /api/routes/:id — 單條官方路線詳情（含座標與完整內容）
 */
async function getOfficialRouteById(req, res) {
  try {
    const { id } = req.params;
    if (!id) return fail(res, '缺少路線 id', 400);

    const cacheKey = `official_routes:${id}`;
    let data = officialRoutesCache.get(cacheKey);
    if (data) return ok(res, data);

    const route = await OfficialRoute.findById(id).lean();
    if (!route) return fail(res, '找不到該路線', 404);

    data = toSnakePayload({ ...route, toObject: () => route });
    officialRoutesCache.set(cacheKey, data);
    return ok(res, data);
  } catch (err) {
    console.error('getOfficialRouteById error:', err);
    return fail(res, '取得路線詳情失敗', 500);
  }
}

module.exports = {
  listOfficialRoutes,
  getOfficialRouteById,
};
