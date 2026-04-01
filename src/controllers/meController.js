const User = require('../models/User');
const Route = require('../models/Route');
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

    const user = await User.findOne({ _id: userOid })
      .populate({
        path: 'likedRoutes',
        select: 'title stats likeCount createdAt location',
      })
      .lean();
    if (!user) return fail(res, '用戶不存在', 404);
    console.log(
      '[getLiked] raw likedRoutes count:',
      Array.isArray(user.likedRoutes) ? user.likedRoutes.length : 0
    );
    const routes = (user.likedRoutes || []).map((r) => ({
      id: r._id?.toString(),
      title: r.title,
      stats: r.stats,
      like_count: r.likeCount ?? 0,
      created_at: r.createdAt,
    }));
    return ok(res, keysToSnakeCase({ routes }));
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