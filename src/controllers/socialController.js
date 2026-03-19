const User = require('../models/User');
const Route = require('../models/Route');
const mongoose = require('mongoose');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');

/**
 * POST /api/social/toggle-like
 * 原子操作：User.likedRoutes 與 Route.likeCount 同步增減
 */
async function toggleLike(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const postId = req.body?.postId;
    if (!postId) return fail(res, '請提供 postId', 400);
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return fail(res, 'postId 格式無效', 400);
    }
    const id = new mongoose.Types.ObjectId(postId);

    const user = await User.findById(userId);
    if (!user) return fail(res, '用戶不存在', 404);
    const route = await Route.findById(id);
    if (!route) return fail(res, '路線不存在', 404);

    const liked = user.likedRoutes?.some((r) => r.equals(id)) ?? false;

    const runAtomicLike = async (session) => {
      const opts = session ? { session } : {};
      if (liked) {
        await User.findByIdAndUpdate(userId, { $pull: { likedRoutes: id } }, opts);
        await Route.updateOne(
          { _id: id },
          [{ $set: { likeCount: { $max: [0, { $add: ['$likeCount', -1] }] } } }],
          opts
        );
        return { action: 'unliked', liked: false, likeCount: Math.max(0, (route.likeCount ?? 0) - 1) };
      }
      await User.findByIdAndUpdate(userId, { $addToSet: { likedRoutes: id } }, opts);
      await Route.findByIdAndUpdate(id, { $inc: { likeCount: 1 } }, opts);
      return { action: 'liked', liked: true, likeCount: (route.likeCount ?? 0) + 1 };
    };

    try {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const result = await runAtomicLike(session);
        await session.commitTransaction();
        return ok(res, keysToSnakeCase(result));
      } catch (txErr) {
        await session.abortTransaction();
        throw txErr;
      } finally {
        session.endSession();
      }
    } catch (_transactionNotSupported) {
      const result = await runAtomicLike(null);
      return ok(res, keysToSnakeCase(result));
    }
  } catch (err) {
    console.error('toggleLike error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/social/toggle-follow
 * 原子操作：同步更新 A 的 following 與 B 的 followers，以及雙方計數器
 */
async function toggleFollow(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const targetUserId = req.body?.targetUserId ?? req.body?.target_user_id;
    if (!targetUserId) return fail(res, '請提供 target_user_id', 400);
    if (userId === targetUserId) return fail(res, '無法關注自己', 400);
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return fail(res, 'targetUserId 格式無效', 400);
    }
    const targetId = new mongoose.Types.ObjectId(targetUserId);
    const currentId = new mongoose.Types.ObjectId(userId);

    const current = await User.findById(currentId);
    if (!current) return fail(res, '當前用戶不存在', 404);
    const target = await User.findById(targetId);
    if (!target) return fail(res, '目標用戶不存在', 404);

    const following = current.following?.some((f) => f.equals(targetId)) ?? false;

    const runAtomicFollow = async (session) => {
      const opts = session ? { session } : {};
      if (following) {
        await User.findByIdAndUpdate(currentId, { $pull: { following: targetId }, $inc: { followingCount: -1 } }, opts);
        await User.findByIdAndUpdate(targetId, { $pull: { followers: currentId }, $inc: { followersCount: -1 } }, opts);
        return { action: 'unfollowed', following: false, followersCount: Math.max(0, (target.followersCount ?? 0) - 1) };
      }
      await User.findByIdAndUpdate(currentId, { $addToSet: { following: targetId }, $inc: { followingCount: 1 } }, opts);
      await User.findByIdAndUpdate(targetId, { $addToSet: { followers: currentId }, $inc: { followersCount: 1 } }, opts);
      return { action: 'followed', following: true, followersCount: (target.followersCount ?? 0) + 1 };
    };

    try {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const result = await runAtomicFollow(session);
        await session.commitTransaction();
        return ok(res, keysToSnakeCase(result));
      } catch (txErr) {
        await session.abortTransaction();
        throw txErr;
      } finally {
        session.endSession();
      }
    } catch (_transactionNotSupported) {
      const result = await runAtomicFollow(null);
      return ok(res, keysToSnakeCase(result));
    }
  } catch (err) {
    console.error('toggleFollow error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

module.exports = { toggleLike, toggleFollow };