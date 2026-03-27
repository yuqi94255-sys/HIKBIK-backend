const User = require('../models/User');
const Route = require('../models/Route');
const Post = require('../models/Post');
const mongoose = require('mongoose');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');
const { buildSummaryForPublish } = require('../utils/socialPublishSummary');

function normalizePublishPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/** 將 summary 轉為 JSON 安全格式（ObjectId → string） */
function summaryToFeedJson(summary, postId) {
  if (!summary || typeof summary !== 'object') return {};
  const s = { ...summary };
  s.id = s.id || postId;
  if (s.authorId != null && typeof s.authorId === 'object' && s.authorId.toString) {
    s.authorId = s.authorId.toString();
  }
  return s;
}

/**
 * GET /api/social/feed
 * 回傳社群廣場卡片列表（每項含 postCategory + 完整 summary，供 GrandJourney / DetailedTrack）
 */
async function getFeed(req, res) {
  try {
    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

    const docs = await Post.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('postCategory summary createdAt')
      .lean();

    const feed = docs.map((doc) => {
      const postId = doc._id.toString();
      return {
        postCategory: doc.postCategory,
        ...summaryToFeedJson(doc.summary, postId),
      };
    });

    return ok(res, feed);
  } catch (err) {
    console.error('getFeed error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/social/publish
 * Body: { postCategory, renderData | payload, coverImageUrl?, imageUrls? }（二者擇一，可為物件或 JSON 字串）
 */
async function publishSocialPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未授權' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: '無效的用戶 id' });
    }

    const body = req.body || {};
    const postCategory = body.postCategory;
    /** 與前端約定：renderData 或 payload 擇一，寫入模型 renderData */
    const renderData = body.renderData || body.payload;
    const bodyCoverImageUrl = body.coverImageUrl;
    const bodyImageUrls = body.imageUrls;

    if (postCategory !== 'COMMUNITY_MACRO' && postCategory !== 'COMMUNITY_MICRO') {
      return res.status(400).json({
        success: false,
        message: 'postCategory 必須為 COMMUNITY_MACRO 或 COMMUNITY_MICRO',
      });
    }

    const payload = normalizePublishPayload(renderData);
    if (payload == null || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        message: '請提供有效的 renderData 或 payload（物件或 JSON 字串）',
      });
    }

    const user = await User.findById(userId)
      .select('nickname firstName lastName avatarUrl bio')
      .lean();
    if (!user) {
      return res.status(404).json({ success: false, message: '用戶不存在' });
    }

    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      (user.nickname || '').trim() ||
      'Explorer';

    const postId = new mongoose.Types.ObjectId();
    const plain = buildSummaryForPublish(postCategory, payload, {
      postId: postId.toString(),
      authorId: userId,
      authorName: displayName,
      authorAvatarUrl: user.avatarUrl || '',
      authorSubtitle: user.bio || '',
    });

    let coverImageUrl = plain.coverImageUrl ?? '';
    let imageUrls = Array.isArray(plain.imageUrls) ? [...plain.imageUrls] : [];

    if (bodyCoverImageUrl !== undefined) {
      coverImageUrl =
        typeof bodyCoverImageUrl === 'string'
          ? bodyCoverImageUrl.trim()
          : String(bodyCoverImageUrl ?? '');
    }
    if (bodyImageUrls !== undefined) {
      if (!Array.isArray(bodyImageUrls)) {
        return res.status(400).json({
          success: false,
          message: 'imageUrls 必須為陣列',
        });
      }
      imageUrls = bodyImageUrls.map((u) => String(u ?? '').trim()).filter(Boolean);
    }

    const summaryDoc = {
      ...plain,
      coverImageUrl,
      imageUrls,
      authorId: new mongoose.Types.ObjectId(userId),
    };

    const post = await Post.create({
      _id: postId,
      author: userId,
      postCategory,
      coverImageUrl,
      imageUrls,
      renderData: payload,
      summary: summaryDoc,
    });

    return res.status(201).json({
      success: true,
      postId: post._id.toString(),
    });
  } catch (err) {
    console.error('publishSocialPost error:', err);
    return res.status(400).json({
      success: false,
      message: err.message || '發佈失敗',
    });
  }
}

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

module.exports = { toggleLike, toggleFollow, publishSocialPost, getFeed };