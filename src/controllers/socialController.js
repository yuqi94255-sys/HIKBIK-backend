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

function displayNameFromUser(user) {
  if (!user) return 'Explorer';
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || (user.nickname || '').trim() || 'Explorer';
}

/**
 * 與 SocialFeedCommentDTO 對齊：id, authorId, authorName, authorAvatarUrl, text, createdAt, likeCount, isLiked（帶 Token 時計算）
 */
function mapCommentToFeedDto(c, viewerOid) {
  if (!c || c._id == null) return null;
  const aid = c.authorId;
  let authorIdStr = '';
  let authorName = '';
  let authorAvatarUrl = '';
  if (aid != null && typeof aid === 'object' && aid._id != null) {
    authorIdStr = aid._id.toString();
    authorName = displayNameFromUser(aid);
    authorAvatarUrl = String(aid.avatarUrl || '');
  } else if (aid != null) {
    authorIdStr = String(aid);
  }
  const createdAt =
    c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt ?? null;

  const likedByArr = Array.isArray(c.likedBy) ? c.likedBy : [];
  const likeCountFromArray = likedByArr.length;
  const likeCount =
    typeof c.likeCount === 'number' && !Number.isNaN(c.likeCount)
      ? c.likeCount
      : likeCountFromArray;
  const isLiked = viewerOid ? likedByArr.some((x) => x.equals(viewerOid)) : false;

  return {
    id: c._id.toString(),
    authorId: authorIdStr,
    authorName,
    authorAvatarUrl,
    text: c.text != null ? String(c.text) : '',
    createdAt,
    likeCount,
    isLiked,
  };
}

/** 單則貼文 → 與 GET /feed 相同的列表項形狀 */
function mapPostDocToFeedItem(doc, viewerOid) {
  const postId = doc._id.toString();
  const likedBy = Array.isArray(doc.likedBy) ? doc.likedBy : [];
  const isLiked = viewerOid ? likedBy.some((x) => x.equals(viewerOid)) : false;
  const likeCount = doc.likeCount ?? doc.summary?.likeCount ?? 0;
  const commentCount = doc.commentCount ?? doc.summary?.commentCount ?? 0;
  const commentsRaw = Array.isArray(doc.comments) ? doc.comments : [];
  const comments = commentsRaw
    .map((c) => mapCommentToFeedDto(c, viewerOid))
    .filter(Boolean);

  return {
    postCategory: doc.postCategory,
    ...summaryToFeedJson(doc.summary, postId),
    likeCount,
    commentCount,
    isLiked,
    comments,
    renderData: doc.renderData ?? null,
  };
}

function parseFeedLimit(query) {
  const rawLimit = parseInt(String(query?.limit ?? '50'), 10);
  return Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
}

const FEED_POST_SELECT =
  'postCategory summary createdAt renderData likedBy likeCount commentCount comments';

const FEED_COMMENT_POPULATE = {
  path: 'comments.authorId',
  select: 'nickname firstName lastName avatarUrl',
};

/**
 * GET /api/social/feed
 * 帶有效 JWT 時回傳 isLiked；每項含 summary、renderData、comments（DTO）、likeCount、commentCount
 */
async function getFeed(req, res) {
  try {
    const limit = parseFeedLimit(req.query);

    const viewerId = req.user?.id;
    const viewerOid =
      viewerId && mongoose.Types.ObjectId.isValid(viewerId)
        ? new mongoose.Types.ObjectId(viewerId)
        : null;

    const docs = await Post.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(FEED_POST_SELECT)
      .populate(FEED_COMMENT_POPULATE)
      .lean();

    const feed = docs.map((doc) => mapPostDocToFeedItem(doc, viewerOid));

    return ok(res, feed);
  } catch (err) {
    console.error('getFeed error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * GET /api/social/me/posts
 * 當前登入用戶發佈的貼文（形狀同 feed 單項陣列）
 */
async function getMyPosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const viewerOid = new mongoose.Types.ObjectId(userId);
    const limit = parseFeedLimit(req.query);

    const docs = await Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(FEED_POST_SELECT)
      .populate(FEED_COMMENT_POPULATE)
      .lean();

    const feed = docs.map((doc) => mapPostDocToFeedItem(doc, viewerOid));
    return ok(res, feed);
  } catch (err) {
    console.error('getMyPosts error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * GET /api/social/me/liked-posts
 * 當前登入用戶已讚的社群貼文（Post.likedBy 含本人；形狀同 feed 單項陣列）
 */
async function getLikedPosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const viewerOid = new mongoose.Types.ObjectId(userId);
    const limit = parseFeedLimit(req.query);

    const docs = await Post.find({ likedBy: viewerOid })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(FEED_POST_SELECT)
      .populate(FEED_COMMENT_POPULATE)
      .lean();

    const feed = docs.map((doc) => mapPostDocToFeedItem(doc, viewerOid));
    return ok(res, feed);
  } catch (err) {
    console.error('getLikedPosts error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/social/publish
 * Body: { postCategory, renderData（主）| payload（兼容舊鍵）, coverImageUrl?, imageUrls? }
 * 詳細行程（days、descriptions 等）在 renderData 內；存庫欄位名為 renderData（Mixed）
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
    /** 主讀 renderData；兼容 payload：等同 const renderData = req.body.renderData || req.body.payload（body 已含預設） */
    const renderData = body.renderData || body.payload;
    const bodyCoverImageUrl = body.coverImageUrl;
    const bodyImageUrls = body.imageUrls;

    if (postCategory !== 'COMMUNITY_MACRO' && postCategory !== 'COMMUNITY_MICRO') {
      return res.status(400).json({
        success: false,
        message: 'postCategory 必須為 COMMUNITY_MACRO 或 COMMUNITY_MICRO',
      });
    }

    const normalizedRenderData = normalizePublishPayload(renderData);
    if (normalizedRenderData == null || typeof normalizedRenderData !== 'object') {
      return res.status(400).json({
        success: false,
        message: '請提供有效的 renderData（或兼容欄位 payload）（物件或 JSON 字串）',
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
    const plain = buildSummaryForPublish(postCategory, normalizedRenderData, {
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
      renderData: normalizedRenderData,
      summary: summaryDoc,
      likedBy: [],
      comments: [],
      likeCount: 0,
      commentCount: 0,
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
 * POST /api/social/:id/like
 * 社群貼文點讚/取消（依 req.user.id 綁定 likedBy）
 */
async function togglePostLike(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const postId = req.params?.id;
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return fail(res, '無效的貼文 id', 400);
    }

    const authorExists = await User.exists({ _id: userId });
    if (!authorExists) return fail(res, '用戶不存在', 404);

    const post = await Post.findById(postId);
    if (!post) return fail(res, '貼文不存在', 404);

    const uid = new mongoose.Types.ObjectId(userId);
    const liked = (post.likedBy || []).some((x) => x.equals(uid));

    if (liked) {
      post.likedBy.pull(uid);
    } else {
      post.likedBy.push(uid);
    }
    post.likeCount = post.likedBy.length;
    if (post.summary) {
      post.summary.likeCount = post.likeCount;
    }
    await post.save();

    return ok(res, {
      likeCount: post.likeCount,
      isLiked: !liked,
    });
  } catch (err) {
    console.error('togglePostLike error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/social/:id/comment
 * Body: { text }
 */
async function addPostComment(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const postId = req.params?.id;
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return fail(res, '無效的貼文 id', 400);
    }

    const text = String(req.body?.text ?? '').trim();
    if (!text) return fail(res, '請提供 text', 400);
    if (text.length > 2000) return fail(res, '評論不可超過 2000 字', 400);

    const author = await User.findById(userId)
      .select('nickname firstName lastName avatarUrl')
      .lean();
    if (!author) return fail(res, '用戶不存在', 404);

    const post = await Post.findById(postId);
    if (!post) return fail(res, '貼文不存在', 404);

    post.comments.push({
      authorId: userId,
      text,
      likedBy: [],
      likeCount: 0,
    });
    post.commentCount = (post.commentCount || 0) + 1;
    if (post.summary) {
      post.summary.commentCount = post.commentCount;
    }
    await post.save();

    const c = post.comments[post.comments.length - 1];
    const createdAt =
      c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt;
    return ok(res, {
      id: c._id.toString(),
      authorId: userId,
      authorName: displayNameFromUser(author),
      authorAvatarUrl: author.avatarUrl || '',
      text: c.text,
      createdAt,
      likeCount: 0,
      isLiked: false,
    });
  } catch (err) {
    console.error('addPostComment error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/social/:id/comment/:commentId/like
 * 評論點讚/取消（綁定 req.user.id，持久化 likedBy / likeCount）
 */
async function toggleCommentLike(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const postId = req.params?.id;
    const commentId = req.params?.commentId;
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return fail(res, '無效的貼文 id', 400);
    }
    if (!commentId || !mongoose.Types.ObjectId.isValid(commentId)) {
      return fail(res, '無效的評論 id', 400);
    }

    const authorExists = await User.exists({ _id: userId });
    if (!authorExists) return fail(res, '用戶不存在', 404);

    const post = await Post.findById(postId);
    if (!post) return fail(res, '貼文不存在', 404);

    const sub = post.comments.id(commentId);
    if (!sub) return fail(res, '評論不存在', 404);

    if (!Array.isArray(sub.likedBy)) {
      sub.likedBy = [];
    }

    const uid = new mongoose.Types.ObjectId(userId);
    const liked = sub.likedBy.some((x) => x.equals(uid));

    if (liked) {
      sub.likedBy.pull(uid);
    } else {
      sub.likedBy.push(uid);
    }
    sub.likeCount = sub.likedBy.length;

    await post.save();

    return ok(res, {
      commentId: sub._id.toString(),
      likeCount: sub.likeCount,
      isLiked: !liked,
    });
  } catch (err) {
    console.error('toggleCommentLike error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/social/toggle-like
 * 僅處理「路線 Route」：User.likedRoutes（ObjectId）與 Route.likeCount 同步增減。
 * 社群貼文請用 POST /api/social/:id/like（:id 為 feed 回傳之 MongoDB 貼文 _id，不可用 cloud_ 等 Mock id）。
 */
async function toggleLike(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const rawInputId =
      req.body?.postId ?? req.body?.post_id ?? req.body?.id ?? req.params?.id;
    if (rawInputId == null || (typeof rawInputId === 'string' && !rawInputId.trim())) {
      return fail(res, '請提供 postId（或 post_id）', 400);
    }
    const rawId = String(rawInputId).trim();
    console.log('--- ToggleLike Attempt ---', { userId, targetId: rawId });
    if (!mongoose.Types.ObjectId.isValid(rawId)) {
      console.log('--- ToggleLike Attempt ---', { userId, targetId: rawId, error: 'invalid_objectid' });
      return res.status(400).json({ message: 'Invalid Route ID or Route not found' });
    }
    const id = new mongoose.Types.ObjectId(rawId);

    const user = await User.findById(userId);
    if (!user) return fail(res, '用戶不存在', 404);
    console.log('Target ID:', id, 'User Liked List:', user.likedRoutes);
    const liked = user.likedRoutes?.some((r) => r.equals(id)) ?? false;
    console.log('Current liked status before change:', liked);

    const runAtomicLike = async (session) => {
      const opts = session ? { session } : {};
      const [targetRoute, targetPost] = await Promise.all([
        Route.findById(id),
        Post.findById(id).select('_id'),
      ]);
      const targetModelName = targetRoute
        ? 'Route'
        : (targetPost ? 'Post' : 'NotFound');
      console.log('Target found in:', targetModelName);

      // 點讚的是 Route，因此僅操作 User.likedRoutes（Route ObjectId 集合）
      await User.findByIdAndUpdate(userId, { $addToSet: { likedRoutes: id } }, opts);
      if (targetRoute && !liked) {
        await Route.findByIdAndUpdate(id, { $inc: { likeCount: 1 } }, opts);
      }
      return {
        action: 'liked',
        liked: true,
        likeCount: targetRoute ? (targetRoute.likeCount ?? 0) + (liked ? 0 : 1) : 0,
      };
    };

    const respondOk = async (result) => {
      const updatedUser = await User.findById(userId).select('likedRoutes').lean();
      console.log('User likedRoutes after save:', updatedUser?.likedRoutes || []);
      const likedRoutesCount = Array.isArray(updatedUser?.likedRoutes)
        ? updatedUser.likedRoutes.length
        : 0;
      return ok(res, keysToSnakeCase({ ...result, likedRoutesCount }));
    };

    try {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const result = await runAtomicLike(session);
        await session.commitTransaction();
        return await respondOk(result);
      } catch (txErr) {
        await session.abortTransaction();
        throw txErr;
      } finally {
        session.endSession();
      }
    } catch (_transactionNotSupported) {
      const result = await runAtomicLike(null);
      return await respondOk(result);
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

module.exports = {
  toggleLike,
  toggleFollow,
  publishSocialPost,
  getFeed,
  getMyPosts,
  getLikedPosts,
  togglePostLike,
  addPostComment,
  toggleCommentLike,
};