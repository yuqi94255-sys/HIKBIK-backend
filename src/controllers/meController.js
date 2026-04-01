const User = require('../models/User');
const Route = require('../models/Route');
const Post = require('../models/Post');
const mongoose = require('mongoose');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase, pickBody } = require('../utils/snakeCase');

/**
 * GET /api/me/destinations
 * 回傳當前用戶收藏的目的地列表（對齊 SavedDestination）
 */
async function getDestinations(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    const user = await User.findById(userId).lean();
    if (!user) return fail(res, '用戶不存在', 404);
    const list = (user.savedDestinations || []).map((d) => ({
      id: d._id?.toString(),
      name: d.name ?? '',
      category: d.category ?? '',
      agency: d.agency ?? '',
      image_url: d.imageUrl ?? '',
      latitude: d.latitude,
      longitude: d.longitude,
      date_saved: d.dateSaved ?? d.createdAt,
    }));
    return ok(res, keysToSnakeCase({ destinations: list }));
  } catch (err) {
    console.error('getDestinations error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/me/destinations（Toggle）
 * Body 含 id 則從收藏移除；否則新增（需 name, category, latitude, longitude 等，snake_case）
 */
async function toggleDestinations(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const b = req.body || {};
    const destId = b.id ?? b.destination_id;

    if (destId) {
      const user = await User.findById(userId);
      if (!user) return fail(res, '用戶不存在', 404);
      const subdoc = user.savedDestinations?.id(destId);
      if (!subdoc) return fail(res, '該目的地不在收藏中', 404);
      subdoc.deleteOne();
      await user.save();
      const list = (user.savedDestinations || []).map((d) => ({
        id: d._id?.toString(),
        name: d.name ?? '',
        category: d.category ?? '',
        agency: d.agency ?? '',
        image_url: d.imageUrl ?? '',
        latitude: d.latitude,
        longitude: d.longitude,
        date_saved: d.dateSaved,
      }));
      return ok(res, keysToSnakeCase({ action: 'removed', destinations: list }));
    }

    const name = b.name ?? '';
    const category = b.category ?? '';
    const agency = b.agency ?? '';
    const imageUrl = b.image_url ?? '';
    const lat = Number(b.latitude);
    const lon = Number(b.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return fail(res, '請提供 latitude 與 longitude', 400);
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          savedDestinations: {
            name: String(name),
            category: String(category),
            agency: String(agency),
            imageUrl: String(imageUrl),
            latitude: lat,
            longitude: lon,
            dateSaved: new Date(),
          },
        },
      },
      { new: true }
    ).lean();
    const list = (user.savedDestinations || []).map((d) => ({
      id: d._id?.toString(),
      name: d.name ?? '',
      category: d.category ?? '',
      agency: d.agency ?? '',
      image_url: d.imageUrl ?? '',
      latitude: d.latitude,
      longitude: d.longitude,
      date_saved: d.dateSaved,
    }));
    return ok(res, keysToSnakeCase({ action: 'added', destinations: list }));
  } catch (err) {
    console.error('toggleDestinations error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * GET /api/me/liked
 * 回傳該用戶點讚的 Route 列表
 */
async function getLiked(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    console.log('Fetching likes for user:', userId);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, '無效的用戶 id', 400);
    }
    const userOid = new mongoose.Types.ObjectId(userId);

    // 地毯式排查：先看原始欄位（未 populate）
    const userRaw = await User.findById(userOid).select('likedRoutes');
    console.log('User raw likedRoutes:', userRaw?.likedRoutes || []);

    const user = await User.findOne({ _id: userOid }).select('likedRoutes').lean();
    if (!user) return fail(res, '用戶不存在', 404);

    const likedIds = (user.likedRoutes || [])
      .map((x) => (x && x.toString ? x.toString() : String(x || '')))
      .filter((x) => mongoose.Types.ObjectId.isValid(x));

    let likedRoutes = [];
    if (likedIds.length > 0) {
      const oidList = likedIds.map((x) => new mongoose.Types.ObjectId(x));
      // 暴力修復：同時掃 Route 與 JourneyPost（本專案以 Post 模型承載）
      const [routes, journeyPosts] = await Promise.all([
        Route.find({ _id: { $in: oidList } })
          .select('title stats likeCount createdAt location')
          .lean(),
        Post.find({ _id: { $in: oidList } })
          .select('summary renderData postCategory coverImageUrl imageUrls likeCount createdAt')
          .lean(),
      ]);

      const routeMap = new Map(routes.map((d) => [d._id.toString(), d]));
      const postMap = new Map(journeyPosts.map((d) => [d._id.toString(), d]));

      likedRoutes = likedIds.map((id) => {
        const r = routeMap.get(id);
        if (r) {
          return {
            id,
            source: 'route',
            title: r.title || `Liked route ${id.slice(-6)}`,
            postCategory: 'ROUTE',
            coverImageUrl: '',
            stats: r.stats,
            like_count: r.likeCount ?? 0,
            created_at: r.createdAt,
            location: r.location ?? null,
          };
        }

        const p = postMap.get(id);
        if (p) {
          const title =
            p.summary?.title ||
            p.renderData?.title ||
            p.renderData?.name ||
            `Liked post ${id.slice(-6)}`;
          const coverImageUrl =
            p.coverImageUrl ||
            p.summary?.coverImageUrl ||
            (Array.isArray(p.imageUrls) ? p.imageUrls[0] : '') ||
            '';
          return {
            id,
            source: 'journey_post',
            title,
            postCategory: p.postCategory || 'JOURNEY_POST',
            coverImageUrl,
            image_urls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
            like_count: p.likeCount ?? 0,
            created_at: p.createdAt,
          };
        }

        // 兜底：即使兩表都找不到，仍回傳最小資訊，避免前端收到空陣列
        return {
          id,
          source: 'unknown',
          title: `Liked item ${id.slice(-6)}`,
          postCategory: 'UNKNOWN',
          coverImageUrl: '',
          image_urls: [],
          like_count: 0,
          created_at: null,
        };
      });
    }

    console.log('User ID:', req.user.id, 'Fetched Liked Count:', likedRoutes.length);
    return ok(res, {
      likedRoutes,
      // 兼容舊前端欄位
      routes: likedRoutes,
    });
  } catch (err) {
    console.error('getLiked error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * GET /api/me/saved
 * 回傳該用戶收藏的 Destination 列表（與 destinations 同結構）
 */
async function getSaved(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    const user = await User.findById(userId).lean();
    if (!user) return fail(res, '用戶不存在', 404);
    const list = (user.savedDestinations || []).map((d) => ({
      id: d._id?.toString(),
      name: d.name ?? '',
      category: d.category ?? '',
      agency: d.agency ?? '',
      image_url: d.imageUrl ?? '',
      latitude: d.latitude,
      longitude: d.longitude,
      date_saved: d.dateSaved ?? d.createdAt,
    }));
    return ok(res, keysToSnakeCase({ destinations: list }));
  } catch (err) {
    console.error('getSaved error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

module.exports = {
  getDestinations,
  toggleDestinations,
  getLiked,
  getSaved,
};