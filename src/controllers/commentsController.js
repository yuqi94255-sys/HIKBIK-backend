const Comment = require('../models/Comment');
const User = require('../models/User');
const mongoose = require('mongoose');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase, pickBody } = require('../utils/snakeCase');

/**
 * GET /api/posts/:id/comments
 */
async function getComments(req, res) {
  try {
    const postId = req.params?.id;
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return fail(res, 'post id 無效', 400);
    }
    const comments = await Comment.find({ postId }).sort({ date: -1 }).lean();
    const data = comments.map((c) => ({
      id: c._id.toString(),
      post_id: c.postId?.toString(),
      author_name: c.authorName,
      author_id: c.authorId?.toString(),
      text: c.text ?? '',
      like_count: c.likeCount ?? 0,
      date: c.date ?? c.createdAt,
    }));
    return ok(res, keysToSnakeCase({ comments: data }));
  } catch (err) {
    console.error('getComments error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/posts/:id/comments
 * Body: author_name 或從 JWT 取暱稱, text (snake_case)
 */
async function createComment(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const postId = req.params?.id;
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return fail(res, 'post id 無效', 400);
    }
    const body = pickBody(req.body || {}, ['author_name', 'text']);
    const text = body.text ?? req.body?.text ?? '';
    const user = await User.findById(userId).lean();
    const authorName = body.authorName || req.body?.author_name || user?.nickname || 'Explorer';

    const comment = await Comment.create({
      postId,
      authorId: userId,
      authorName: String(authorName),
      text: String(text).trim(),
      likeCount: 0,
      date: new Date(),
    });
    const doc = comment.toObject();
    return ok(res, keysToSnakeCase({
      comment: {
        id: doc._id.toString(),
        post_id: doc.postId?.toString(),
        author_name: doc.authorName,
        author_id: doc.authorId?.toString(),
        text: doc.text ?? '',
        like_count: doc.likeCount ?? 0,
        date: doc.date ?? doc.createdAt,
      },
    }), 201);
  } catch (err) {
    console.error('createComment error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

module.exports = { getComments, createComment };