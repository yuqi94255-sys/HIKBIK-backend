const Route = require('../models/Route');
const User = require('../models/User');
const { ok, fail } = require('../utils/response');

function normalizeWaypoints(waypoints) {
  return waypoints.map((w) => ({
    lat: String(w.lat),
    lon: String(w.lon),
    elevation: Number(w.elevation),
    timestamp: Number(w.timestamp),
  }));
}

/**
 * POST /api/routes/upload
 * 接收 waypoints，建立 Route 並將 routeId 加入該用戶的 publishedTracks
 */
async function uploadRoute(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const { title, waypoints, stats } = req.body;
    if (!waypoints || !Array.isArray(waypoints) || waypoints.length === 0) {
      return fail(res, '請提供 waypoints 陣列（至少一筆，含 lat, lon, elevation, timestamp）', 400);
    }
    const requiredKeys = ['lat', 'lon', 'elevation', 'timestamp'];
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i];
      for (const key of requiredKeys) {
        if (w[key] === undefined || w[key] === null) {
          return fail(res, `waypoints[${i}] 缺少欄位: ${key}`, 400);
        }
      }
    }

    const normalized = normalizeWaypoints(waypoints);
    const route = await Route.create({
      creator: userId,
      title: title != null ? String(title) : '未命名路線',
      waypoints: normalized,
      stats: {
        totalDistance: stats?.totalDistance ?? 0,
        totalAscent: stats?.totalAscent ?? 0,
        avgSpeed: stats?.avgSpeed ?? 0,
      },
    });
    await User.findByIdAndUpdate(userId, { $addToSet: { publishedTracks: route._id } });

    const doc = route.toObject();
    return ok(res, {
      message: '路線已上傳',
      route: {
        id: doc._id.toString(),
        creator: doc.creator.toString(),
        title: doc.title,
        waypoints: doc.waypoints,
        location: doc.location,
        stats: doc.stats,
        createdAt: doc.createdAt,
      },
    }, 201);
  } catch (err) {
    console.error('uploadRoute error:', err);
    return fail(res, '上傳失敗，請稍後再試', 503);
  }
}

/**
 * POST /api/routes/publish
 * 與前端對接：接收 title, totalDistance, totalAscent, waypoints（lat/lon 可為字串或數字，存為 String）
 */
async function publishRoute(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const { title, totalDistance, totalAscent, waypoints } = req.body;
    if (!waypoints || !Array.isArray(waypoints) || waypoints.length === 0) {
      return fail(res, '請提供 waypoints 陣列（至少一筆，含 lat, lon, elevation, timestamp）', 400);
    }
    const requiredKeys = ['lat', 'lon', 'elevation', 'timestamp'];
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i];
      for (const key of requiredKeys) {
        if (w[key] === undefined || w[key] === null) {
          return fail(res, `waypoints[${i}] 缺少欄位: ${key}`, 400);
        }
      }
    }

    const distance = Number(totalDistance) || 0;
    const normalized = normalizeWaypoints(waypoints);
    const route = await Route.create({
      creator: userId,
      title: title != null ? String(title) : '未命名路線',
      waypoints: normalized,
      stats: {
        totalDistance: distance,
        totalAscent: Number(totalAscent) ?? 0,
        avgSpeed: 0,
      },
    });

    await User.findByIdAndUpdate(userId, {
      $addToSet: { publishedTracks: route._id },
      $inc: { totalDistanceMeters: distance },
    });

    const doc = route.toObject();
    return ok(res, {
      message: '路線已發佈',
      route: {
        id: doc._id.toString(),
        creator: doc.creator.toString(),
        title: doc.title,
        totalDistance: doc.stats?.totalDistance ?? 0,
        totalAscent: doc.stats?.totalAscent ?? 0,
        waypoints: doc.waypoints,
        location: doc.location,
        stats: doc.stats,
        createdAt: doc.createdAt,
      },
    }, 201);
  } catch (err) {
    console.error('publishRoute error:', err);
    return fail(res, '發佈失敗，請稍後再試', 503);
  }
}

/**
 * GET /api/routes/feed?page=1&limit=10
 * 社區流：所有用戶最新發布路線，分頁，關聯查詢作者 nickname、avatarUrl
 */
async function getFeed(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 10, 1), 100);
    const page = Math.max(Number(req.query?.page) || 1, 1);
    const skip = (page - 1) * limit;

    const [routes, total] = await Promise.all([
      Route.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('creator', 'nickname avatarUrl')
        .lean(),
      Route.countDocuments(),
    ]);

    const feed = routes.map((r) => {
      const creator = r.creator;
      return {
        id: r._id.toString(),
        title: r.title,
        stats: r.stats,
        likeCount: r.likeCount ?? 0,
        location: r.location,
        createdAt: r.createdAt,
        author: {
          id: creator?._id?.toString() ?? '',
          nickname: creator?.nickname ?? 'Explorer',
          avatarUrl: creator?.avatarUrl ?? '',
        },
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;
    return ok(res, { feed, total, page, limit, totalPages });
  } catch (err) {
    console.error('getFeed error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

module.exports = { uploadRoute, publishRoute, getFeed };
