const User = require('../models/User');
const Route = require('../models/Route');
const Post = require('../models/Post');
const mongoose = require('mongoose');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');
const { followingIdsFromUser } = require('../utils/followingIds');
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

    // Batch-fetch live followersCounts for all unique authors so the iOS client
    // can seed SocialManager with real counts rather than defaulting to 0.
    const rawAuthorIds = feed.map((f) => f.authorId).filter(Boolean);
    const uniqueAuthorIds = [...new Set(rawAuthorIds)].filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );
    if (uniqueAuthorIds.length > 0) {
      const authorDocs = await User.find({
        _id: { $in: uniqueAuthorIds.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select('followersCount')
        .lean();
      const countMap = {};
      for (const a of authorDocs) {
        countMap[a._id.toString()] = a.followersCount ?? 0;
      }
      for (const item of feed) {
        if (item.authorId && countMap[item.authorId] !== undefined) {
          item.authorFollowersCount = countMap[item.authorId];
        }
      }
    }

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
 * Body: targetId（或 post_id / postId / id）、targetType（POST | ROUTE，可省略則依資料庫自動判斷）
 * 同步：User.likedRoutes ↔ Post|Route 的 likedBy、likeCount（計數與 likedBy 長度一致）
 */
function isTransactionUnsupportedError(msg) {
  if (typeof msg !== 'string') return false;
  return (
    msg.includes('Transaction numbers are only allowed') ||
    msg.includes('replica set') ||
    msg.includes('mongos') ||
    msg.includes('Multi-document transactions are not supported')
  );
}

async function toggleLike(req, res) {
  const userId = req.user?.id;
  if (!userId) return fail(res, '未授權', 401);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return fail(res, '無效的用戶 id', 400);
  }

  const rawTargetId =
    req.body?.targetId ??
    req.body?.target_id ??
    req.body?.postId ??
    req.body?.post_id ??
    req.body?.id ??
    req.params?.id;
  if (rawTargetId == null || (typeof rawTargetId === 'string' && !String(rawTargetId).trim())) {
    return fail(res, '請提供 targetId（或 post_id）', 400);
  }
  const rawId = String(rawTargetId).trim();
  if (!mongoose.Types.ObjectId.isValid(rawId)) {
    return fail(res, '無效的 targetId', 400);
  }
  const targetOid = new mongoose.Types.ObjectId(rawId);
  const userOid = new mongoose.Types.ObjectId(userId);

  let targetType = (req.body?.targetType ?? req.body?.target_type ?? '')
    .toString()
    .trim()
    .toUpperCase();

  if (targetType !== 'POST' && targetType !== 'ROUTE') {
    const [r, p] = await Promise.all([
      Route.findById(targetOid).select('_id').lean(),
      Post.findById(targetOid).select('_id').lean(),
    ]);
    if (r && !p) targetType = 'ROUTE';
    else if (p && !r) targetType = 'POST';
    else if (r && p) {
      return fail(res, '請提供 targetType：POST 或 ROUTE', 400);
    } else {
      return fail(res, '找不到目標', 404);
    }
  } else {
    const exists =
      targetType === 'ROUTE'
        ? await Route.exists({ _id: targetOid })
        : await Post.exists({ _id: targetOid });
    if (!exists) return fail(res, '找不到目標', 404);
  }

  const runToggle = async (session) => {
    const sess = session || undefined;
    const user = await User.findById(userId).session(sess);
    if (!user) {
      const e = new Error('用戶不存在');
      e.status = 404;
      throw e;
    }

    if (targetType === 'POST') {
      const post = await Post.findById(targetOid).session(sess);
      if (!post) {
        const e = new Error('找不到貼文');
        e.status = 404;
        throw e;
      }

      const liked = (post.likedBy || []).some((x) => x.equals(userOid));
      if (!liked) {
        post.likedBy.push(userOid);
        await User.findByIdAndUpdate(
          userId,
          { $addToSet: { likedRoutes: targetOid } },
          { session: sess }
        );
      } else {
        post.likedBy.pull(userOid);
        await User.findByIdAndUpdate(
          userId,
          { $pull: { likedRoutes: targetOid } },
          { session: sess }
        );
      }
      post.likeCount = post.likedBy.length;
      if (post.summary) {
        post.summary.likeCount = post.likeCount;
      }
      await post.save({ session: sess });
      return { isLiked: !liked, likeCount: post.likeCount };
    }

    const route = await Route.findById(targetOid).session(sess);
    if (!route) {
      const e = new Error('找不到路線');
      e.status = 404;
      throw e;
    }
    if (!Array.isArray(route.likedBy)) {
      route.likedBy = [];
    }
    const liked = route.likedBy.some((x) => x.equals(userOid));
    if (!liked) {
      route.likedBy.push(userOid);
      await User.findByIdAndUpdate(
        userId,
        { $addToSet: { likedRoutes: targetOid } },
        { session: sess }
      );
    } else {
      route.likedBy.pull(userOid);
      await User.findByIdAndUpdate(
        userId,
        { $pull: { likedRoutes: targetOid } },
        { session: sess }
      );
    }
    route.likeCount = route.likedBy.length;
    await route.save({ session: sess });
    return { isLiked: !liked, likeCount: route.likeCount };
  };

  try {
    let session;
    try {
      session = await mongoose.startSession();
    } catch {
      const out = await runToggle(null);
      return res.status(200).json({
        success: true,
        isLiked: out.isLiked,
        likeCount: out.likeCount,
      });
    }

    try {
      session.startTransaction();
      const out = await runToggle(session);
      await session.commitTransaction();
      return res.status(200).json({
        success: true,
        isLiked: out.isLiked,
        likeCount: out.likeCount,
      });
    } catch (innerErr) {
      if (session.inTransaction && session.inTransaction()) {
        await session.abortTransaction();
      }
      if (isTransactionUnsupportedError(innerErr && innerErr.message)) {
        const out = await runToggle(null);
        return res.status(200).json({
          success: true,
          isLiked: out.isLiked,
          likeCount: out.likeCount,
        });
      }
      throw innerErr;
    } finally {
      session.endSession();
    }
  } catch (err) {
    if (err && err.status === 404) {
      return fail(res, err.message, 404);
    }
    console.error('toggleLike error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * 關注切換核心：先嘗試取消（僅在 following 含對方時才 $pull + $dec），否則在「未關注」時才 $addToSet + $inc。
 * 避免 $addToSet 不變卻仍 $inc 導致計數錯亂；雙向更新需同時成功，否則丟錯以觸發 transaction abort。
 */
async function runSocialFollowToggle(session, currentId, targetId) {
  const opts = session ? { session } : {};

  let meExistsQ = User.exists({ _id: currentId });
  if (session) meExistsQ = meExistsQ.session(session);
  const meExists = await meExistsQ;
  if (!meExists) {
    const e = new Error('當前用戶不存在');
    e.status = 404;
    throw e;
  }
  let themExistsQ = User.exists({ _id: targetId });
  if (session) themExistsQ = themExistsQ.session(session);
  const themExists = await themExistsQ;
  if (!themExists) {
    const e = new Error('目標用戶不存在');
    e.status = 404;
    throw e;
  }

  const unfollowMe = await User.updateOne(
    { _id: currentId, following: targetId },
    { $pull: { following: targetId }, $inc: { followingCount: -1 } },
    opts
  );

  if (unfollowMe.modifiedCount > 0) {
    const unfollowThem = await User.updateOne(
      { _id: targetId, followers: currentId },
      { $pull: { followers: currentId }, $inc: { followersCount: -1 } },
      opts
    );
    if (unfollowThem.modifiedCount === 0) {
      const e = new Error('關注資料不一致，請重試');
      e.status = 409;
      throw e;
    }
  } else {
    const followMe = await User.updateOne(
      { _id: currentId, following: { $nin: [targetId] } },
      { $addToSet: { following: targetId }, $inc: { followingCount: 1 } },
      opts
    );
    if (followMe.modifiedCount > 0) {
      const followThem = await User.updateOne(
        { _id: targetId, followers: { $nin: [currentId] } },
        { $addToSet: { followers: currentId }, $inc: { followersCount: 1 } },
        opts
      );
      if (followThem.modifiedCount === 0) {
        const e = new Error('關注資料不一致，請重試');
        e.status = 409;
        throw e;
      }
    }
  }

  let meQ = User.findById(currentId).select('following followingCount');
  let themQ = User.findById(targetId).select('followersCount');
  if (session) {
    meQ = meQ.session(session);
    themQ = themQ.session(session);
  }
  const [me, them] = await Promise.all([meQ.lean(), themQ.lean()]);

  if (!me || !them) {
    const e = new Error('讀取用戶資料失敗');
    e.status = 503;
    throw e;
  }

  const followingIds = followingIdsFromUser(me);
  const followingAfter = (me.following || []).some((f) => f.equals(targetId));
  const targetStr = targetId.toString();

  if (followingAfter !== followingIds.includes(targetStr)) {
    const e = new Error('關注資料不一致，請重試');
    e.status = 409;
    throw e;
  }

  return {
    action: followingAfter ? 'followed' : 'unfollowed',
    following: followingAfter,
    followingCount: me.followingCount ?? 0,
    followersCount: them.followersCount ?? 0,
    user: {
      followingIds,
    },
  };
}

async function executeFollowToggleTransaction(currentId, targetId, res) {
  const run = () => runSocialFollowToggle(null, currentId, targetId);

  let session;
  try {
    session = await mongoose.startSession();
  } catch {
    const result = await run();
    return ok(res, keysToSnakeCase(result));
  }

  try {
    session.startTransaction();
    const result = await runSocialFollowToggle(session, currentId, targetId);
    await session.commitTransaction();
    return ok(res, keysToSnakeCase(result));
  } catch (innerErr) {
    if (session.inTransaction && session.inTransaction()) {
      await session.abortTransaction();
    }
    if (isTransactionUnsupportedError(innerErr && innerErr.message)) {
      const result = await run();
      return ok(res, keysToSnakeCase(result));
    }
    throw innerErr;
  } finally {
    session.endSession();
  }
}

/**
 * POST /api/social/toggle-follow
 * Body: targetUserId | target_user_id（與 /follow/:userId 行為相同：切換關注）
 */
async function toggleFollow(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const targetUserId = req.body?.targetUserId ?? req.body?.target_user_id;
    if (!targetUserId) return fail(res, '請提供 target_user_id', 400);
    if (String(userId) === String(targetUserId)) {
      return fail(res, '無法關注自己', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return fail(res, 'targetUserId 格式無效', 400);
    }

    const targetId = new mongoose.Types.ObjectId(targetUserId);
    const currentId = new mongoose.Types.ObjectId(userId);

    return await executeFollowToggleTransaction(currentId, targetId, res);
  } catch (err) {
    if (err && err.status === 404) {
      return fail(res, err.message, 404);
    }
    if (err && err.status === 409) {
      return fail(res, err.message, 409);
    }
    console.error('toggleFollow error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/social/follow/:userId
 * 路徑參數為目標用戶 _id；與 toggle-follow 相同邏輯（冪等、雙向同步、回傳雙方計數）
 */
async function followUserByParam(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const targetUserId = req.params?.userId;
    if (!targetUserId || !String(targetUserId).trim()) {
      return fail(res, '請提供路徑參數 userId', 400);
    }
    if (String(userId) === String(targetUserId)) {
      return fail(res, '無法關注自己', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return fail(res, 'userId 格式無效', 400);
    }

    const targetId = new mongoose.Types.ObjectId(targetUserId);
    const currentId = new mongoose.Types.ObjectId(userId);

    return await executeFollowToggleTransaction(currentId, targetId, res);
  } catch (err) {
    if (err && err.status === 404) {
      return fail(res, err.message, 404);
    }
    if (err && err.status === 409) {
      return fail(res, err.message, 409);
    }
    console.error('followUserByParam error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

module.exports = {
  toggleLike,
  toggleFollow,
  followUserByParam,
  publishSocialPost,
  getFeed,
  getMyPosts,
  getLikedPosts,
  togglePostLike,
  addPostComment,
  toggleCommentLike,
};