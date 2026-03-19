const RouteReview = require('../models/RouteReview');
const Route = require('../models/Route');
const User = require('../models/User');
const mongoose = require('mongoose');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');

/**
 * GET /api/routes/:routeId/reviews
 * 取得某路線的所有評論（對齊前端 RouteReview：rating, comment, author, date, userId）
 */
async function listByRoute(req, res) {
  try {
    const routeId = req.params?.id ?? req.params?.routeId;
    if (!routeId || !mongoose.Types.ObjectId.isValid(routeId)) {
      return fail(res, 'route id 無效', 400);
    }
    const reviews = await RouteReview.find({ routeId })
      .sort({ date: -1 })
      .lean();
    const data = reviews.map((r) => ({
      id: r._id.toString(),
      route_id: r.routeId?.toString(),
      rating: r.rating,
      comment: r.comment ?? '',
      author: r.author,
      date: r.date ?? r.createdAt,
      user_id: r.userId?.toString(),
    }));
    return ok(res, keysToSnakeCase({ reviews: data }));
  } catch (err) {
    console.error('listByRoute error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/routes/:routeId/reviews
 * 新增評論（需 JWT，author 可從當前用戶 nickname 帶入）
 */
async function create(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const routeId = req.params?.id ?? req.params?.routeId;
    if (!routeId || !mongoose.Types.ObjectId.isValid(routeId)) {
      return fail(res, 'route id 無效', 400);
    }
    const route = await Route.findById(routeId);
    if (!route) return fail(res, '路線不存在', 404);

    const rating = req.body?.rating;
    const comment = req.body?.comment ?? req.body?.comment;
    if (rating === undefined || rating === null) {
      return fail(res, '請提供 rating', 400);
    }
    const numRating = Number(rating);
    if (numRating < 1 || numRating > 5) {
      return fail(res, 'rating 需為 1–5', 400);
    }

    const user = await User.findById(userId).lean();
    const author = user?.nickname ?? 'Explorer';

    const review = await RouteReview.create({
      routeId,
      rating: numRating,
      comment: typeof comment === 'string' ? comment.trim() : '',
      author,
      date: new Date(),
      userId,
    });
    const doc = review.toObject();
    return ok(res, keysToSnakeCase({
      review: {
        id: doc._id.toString(),
        route_id: doc.routeId?.toString(),
        rating: doc.rating,
        comment: doc.comment ?? '',
        author: doc.author,
        date: doc.date,
        user_id: doc.userId?.toString(),
      },
    }), 201);
  } catch (err) {
    console.error('create review error:', err);
    return fail(res, '新增評論失敗', 503);
  }
}

/**
 * GET /api/routes/:routeId/reviews/:reviewId
 */
async function getOne(req, res) {
  try {
    const routeId = req.params?.id ?? req.params?.routeId;
    const reviewId = req.params?.reviewId;
    if (!mongoose.Types.ObjectId.isValid(routeId) || !mongoose.Types.ObjectId.isValid(reviewId)) {
      return fail(res, '參數無效', 400);
    }
    const review = await RouteReview.findOne({ _id: reviewId, routeId }).lean();
    if (!review) return fail(res, '評論不存在', 404);
    return ok(res, keysToSnakeCase({
      id: review._id.toString(),
      route_id: review.routeId?.toString(),
      rating: review.rating,
      comment: review.comment ?? '',
      author: review.author,
      date: review.date ?? review.createdAt,
      user_id: review.userId?.toString(),
    }));
  } catch (err) {
    console.error('getOne review error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * PATCH /api/routes/:routeId/reviews/:reviewId
 * 僅允許本人更新 comment、rating
 */
async function update(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const routeId = req.params?.id ?? req.params?.routeId;
    const reviewId = req.params?.reviewId;
    if (!mongoose.Types.ObjectId.isValid(routeId) || !mongoose.Types.ObjectId.isValid(reviewId)) {
      return fail(res, '參數無效', 400);
    }
    const review = await RouteReview.findOne({ _id: reviewId, routeId });
    if (!review) return fail(res, '評論不存在', 404);
    if (review.userId?.toString() !== userId) {
      return fail(res, '僅能編輯自己的評論', 403);
    }

    const rating = req.body?.rating;
    const comment = req.body?.comment;
    const updates = {};
    if (rating !== undefined) {
      const num = Number(rating);
      if (num < 1 || num > 5) return fail(res, 'rating 需為 1–5', 400);
      updates.rating = num;
    }
    if (comment !== undefined) updates.comment = typeof comment === 'string' ? comment.trim() : comment;
    if (Object.keys(updates).length === 0) {
      return fail(res, '請提供 rating 或 comment', 400);
    }

    const updated = await RouteReview.findByIdAndUpdate(
      reviewId,
      { $set: updates },
      { new: true }
    ).lean();
    return ok(res, keysToSnakeCase({
      id: updated._id.toString(),
      route_id: updated.routeId?.toString(),
      rating: updated.rating,
      comment: updated.comment ?? '',
      author: updated.author,
      date: updated.date ?? updated.updatedAt,
      user_id: updated.userId?.toString(),
    }));
  } catch (err) {
    console.error('update review error:', err);
    return fail(res, '更新失敗', 503);
  }
}

/**
 * DELETE /api/routes/:routeId/reviews/:reviewId
 * 僅允許本人刪除
 */
async function remove(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const routeId = req.params?.id ?? req.params?.routeId;
    const reviewId = req.params?.reviewId;
    if (!mongoose.Types.ObjectId.isValid(routeId) || !mongoose.Types.ObjectId.isValid(reviewId)) {
      return fail(res, '參數無效', 400);
    }
    const review = await RouteReview.findOne({ _id: reviewId, routeId });
    if (!review) return fail(res, '評論不存在', 404);
    if (review.userId?.toString() !== userId) {
      return fail(res, '僅能刪除自己的評論', 403);
    }
    await RouteReview.findByIdAndDelete(reviewId);
    return ok(res, keysToSnakeCase({ message: '已刪除' }));
  } catch (err) {
    console.error('remove review error:', err);
    return fail(res, '刪除失敗', 503);
  }
}

module.exports = {
  listByRoute,
  create,
  getOne,
  update,
  remove,
};
