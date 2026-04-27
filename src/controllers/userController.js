const mongoose = require('mongoose');
const User = require('../models/User');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');
const { followingIdsFromUser } = require('../utils/followingIds');

/** GET /api/users/me 等回傳給前端的 profile 欄位（camelCase，含真實 email / firstName / lastName / avatarUrl） */
function profilePayload(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    email: user.email ?? '',
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    nickname: user.nickname ?? 'Explorer',
    avatarUrl: user.avatarUrl ?? '',
    bio: user.bio ?? '',
    hometown: user.hometown ?? '',
    followingCount: user.followingCount ?? 0,
    followersCount: user.followersCount ?? 0,
    totalDistanceMeters: user.totalDistanceMeters ?? 0,
    /** 當前用戶關注的 User _id 字串列表，供前端啟動快取 */
    followingIds: followingIdsFromUser(user),
  };
}

const ALLOWED_PROFILE_FIELDS = ['firstName', 'lastName', 'nickname', 'bio', 'avatarUrl', 'hometown'];
const NICKNAME_MIN = 1;
const NICKNAME_MAX = 30;
const BIO_MAX = 500;
const AVATAR_URL_MAX = 2048;

/**
 * GET /api/users/saved-parks、GET /api/user/saved-parks、GET /api/users/me/saved-parks
 * 回傳當前用戶收藏的國家公園（savedParks；尚無資料時為空陣列）
 */
async function getSavedParks(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const user = await User.findById(userId).select('savedParks').lean();
    if (!user) return fail(res, '用戶不存在', 404);

    const raw = Array.isArray(user.savedParks) ? user.savedParks : [];
    const parks = raw.map((p) => ({
      id: p._id?.toString(),
      parkCode: p.parkCode ?? '',
      fullName: p.fullName ?? '',
      coverImage: p.coverImage ?? '',
      description: p.description ?? '',
      dateSaved: p.dateSaved ?? p.createdAt,
    }));

    return ok(res, keysToSnakeCase({ parks }));
  } catch (err) {
    console.error('getSavedParks error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * GET /api/users/me
 */
async function getProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const user = await User.findById(userId).lean();
    if (!user) return fail(res, '用戶不存在', 404);

    return ok(res, profilePayload(user));
  } catch (err) {
    console.error('getProfile error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * PATCH /api/users/me、PATCH /api/users/profile、PATCH /api/auth/profile
 * 允許更新 firstName, lastName, nickname, bio, avatarUrl（MongoDB 欄位皆小駝峰）
 * 成功回傳 { success, data: profilePayload, message }，與 GET /me 同形，供 decodeUserProfileFromAPIBody
 */
async function updateProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const body = req.body || {};
    const normalizedBody = {
      ...body,
      firstName: body.firstName ?? body.first_name,
      lastName: body.lastName ?? body.last_name,
      avatarUrl: body.avatarUrl ?? body.avatar_url,
    };

    const updates = {};
    for (const key of ALLOWED_PROFILE_FIELDS) {
      if (normalizedBody[key] !== undefined) {
        updates[key] =
          typeof normalizedBody[key] === 'string'
            ? normalizedBody[key].trim()
            : normalizedBody[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      return fail(res, '請提供 firstName、lastName、nickname、bio 或 avatarUrl 至少一項', 400);
    }
    console.log(
      `[UPDATE] 用戶正在更新：firstName: ${updates.firstName ?? '(unchanged)'}, bio: ${updates.bio ?? '(unchanged)'}`
    );
    if (updates.firstName !== undefined) {
      if (typeof updates.firstName !== 'string') return fail(res, 'firstName 格式錯誤', 400);
      if (updates.firstName.length > 50) return fail(res, 'firstName 不可超過 50 字', 400);
    }
    if (updates.lastName !== undefined) {
      if (typeof updates.lastName !== 'string') return fail(res, 'lastName 格式錯誤', 400);
      if (updates.lastName.length > 50) return fail(res, 'lastName 不可超過 50 字', 400);
    }
    if (updates.nickname !== undefined) {
      if (typeof updates.nickname !== 'string' || updates.nickname.length < NICKNAME_MIN) {
        return fail(res, '暱稱不可為空', 400);
      }
      if (updates.nickname.length > NICKNAME_MAX) {
        return fail(res, `暱稱不可超過 ${NICKNAME_MAX} 字`, 400);
      }
    }
    if (updates.bio !== undefined) {
      const bio = typeof updates.bio === 'string' ? updates.bio : String(updates.bio);
      if (bio.length > BIO_MAX) return fail(res, `簡介不可超過 ${BIO_MAX} 字`, 400);
      updates.bio = bio;
    }
    if (updates.avatarUrl !== undefined) {
      const url = typeof updates.avatarUrl === 'string' ? updates.avatarUrl : String(updates.avatarUrl);
      if (url.length > AVATAR_URL_MAX) return fail(res, `頭像網址不可超過 ${AVATAR_URL_MAX} 字`, 400);
      updates.avatarUrl = url;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    if (!user) return fail(res, '用戶不存在', 404);

    return ok(res, profilePayload(user));
  } catch (err) {
    console.error('updateProfile error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/users/avatar
 * multipart: field name = avatar
 */
async function uploadAvatar(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    if (!req.file) {
      return fail(res, '請以 multipart/form-data 上傳欄位 avatar（檔案）', 400);
    }

    const relPath = `/uploads/${req.file.filename}`;
    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: { avatarUrl: relPath } },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) return fail(res, '用戶不存在', 404);

    return ok(res, {
      avatarUrl: relPath,
      user: profilePayload(updated),
    });
  } catch (err) {
    console.error('uploadAvatar error:', err);
    return fail(res, err.message || '上傳失敗', 500);
  }
}

/**
 * GET /api/users/:id/profile
 * 基本資訊 + 由 followers/following 陣列計算的計數；帶有效 Token 時回傳 isFollowing（當前用戶 id 是否在對方 followers 中）
 */
async function getUserProfile(req, res) {
  try {
    const id = req.params?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const user = await User.findById(id).select('nickname avatarUrl bio followers following').lean();
    if (!user) return fail(res, '用戶不存在', 404);

    const followers = Array.isArray(user.followers) ? user.followers : [];
    const following = Array.isArray(user.following) ? user.following : [];
    const followerCount = followers.length;
    const followingCount = following.length;

    let isFollowing = false;
    const viewerId = req.user?.id;
    if (viewerId && mongoose.Types.ObjectId.isValid(viewerId)) {
      const vid = new mongoose.Types.ObjectId(viewerId);
      isFollowing = followers.some((f) => f.equals(vid));
    }

    return ok(res, {
      id: user._id.toString(),
      nickname: user.nickname ?? 'Explorer',
      avatarUrl: user.avatarUrl ?? '',
      bio: user.bio ?? '',
      followerCount,
      followingCount,
      isFollowing,
    });
  } catch (err) {
    console.error('getUserProfile error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

function toFollowingObjectId(entry) {
  if (!entry) return null;
  if (entry instanceof mongoose.Types.ObjectId) return entry;
  if (typeof entry === 'string' && mongoose.Types.ObjectId.isValid(entry)) {
    return new mongoose.Types.ObjectId(entry);
  }
  if (typeof entry === 'object' && entry._id != null) {
    return toFollowingObjectId(entry._id);
  }
  return null;
}

/**
 * GET /api/users/:id/following
 * 回傳該用戶關注列表（等同 populate nickname / avatarUrl / firstName / lastName）。
 * 以 $in 二次查詢：僅回傳仍存在的 User，已刪除的 id 不會出現在陣列中。
 */
async function getUserFollowing(req, res) {
  try {
    const id = req.params?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const user = await User.findById(id).select('following').lean();
    if (!user) return fail(res, '用戶不存在', 404);

    const raw = Array.isArray(user.following) ? user.following : [];
    const orderedIds = [];
    const seen = new Set();
    for (const entry of raw) {
      const oid = toFollowingObjectId(entry);
      if (!oid) continue;
      const key = oid.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      orderedIds.push(oid);
    }

    if (orderedIds.length === 0) {
      return ok(res, []);
    }

    const docs = await User.find({ _id: { $in: orderedIds } })
      .select('nickname avatarUrl firstName lastName bio')
      .lean();

    const byId = new Map(docs.map((d) => [d._id.toString(), d]));

    const items = orderedIds
      .map((oid) => byId.get(oid.toString()))
      .filter((d) => d != null && d._id != null)
      .map((u) => {
        const avatarUrl = u.avatarUrl != null ? String(u.avatarUrl) : '';
        return {
          id: u._id.toString(),
          nickname: u.nickname != null ? String(u.nickname) : 'Explorer',
          avatarUrl,
          profileImage: avatarUrl,
          bio: u.bio != null ? String(u.bio) : '',
          firstName: u.firstName != null ? String(u.firstName) : '',
          lastName: u.lastName != null ? String(u.lastName) : '',
        };
      });

    return ok(res, items);
  } catch (err) {
    console.error('getUserFollowing error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * GET /api/users/:id
 * 回傳用戶 profile 詳情（following_count, followers_count）
 */
async function getPublicProfile(req, res) {
  try {
    const id = req.params?.id;
    if (!id) return fail(res, '缺少用戶 id', 400);
    const user = await User.findById(id).select('nickname avatarUrl bio followingCount followersCount totalDistanceMeters').lean();
    if (!user) return fail(res, '用戶不存在', 404);
    return ok(res, keysToSnakeCase({
      id: user._id.toString(),
      nickname: user.nickname ?? 'Explorer',
      avatar_url: user.avatarUrl ?? '',
      bio: user.bio ?? '',
      following_count: user.followingCount ?? 0,
      followers_count: user.followersCount ?? 0,
      total_distance_meters: user.totalDistanceMeters ?? 0,
    }));
  } catch (err) {
    console.error('getPublicProfile error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/users/:id/follow
 * Body 可選：
 * - { shouldFollow: boolean } / { should_follow: boolean }：指定關注或取消
 * - 不帶 body：直接 toggle
 * 對稱更新 following / followers，並以 $inc 同步冗餘計數器。
 */
async function followUser(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    /** 前端可傳 should_follow 或 shouldFollow；皆未傳則在 runIntent 內 toggle */
    const should_follow = req.body?.should_follow ?? req.body?.shouldFollow;

    const targetUserId = req.params?.id;
    if (!targetUserId) {
      return fail(res, '無效的目標用戶', 400);
    }
    if (userId === targetUserId) {
      return fail(res, '你不能關注你自己（You cannot follow yourself）', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(targetUserId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const targetId = new mongoose.Types.ObjectId(targetUserId);
    const currentId = new mongoose.Types.ObjectId(userId);

    console.log(
      `[Follow Action] User ${req.user.id} should_follow=${typeof should_follow === 'boolean' ? should_follow : 'toggle'} target ${req.params.id}`
    );

    const runIntent = async (session) => {
      const opts = session ? { session } : {};

      let q = User.findById(currentId).select('following');
      if (session) q = q.session(session);
      const current = await q;
      if (!current) return { error: '當前用戶不存在', status: 404 };

      let qt = User.findById(targetId).select('followers');
      if (session) qt = qt.session(session);
      const target = await qt;
      if (!target) return { error: '目標用戶不存在', status: 404 };

      const already = current.following?.some((f) => f.equals(targetId)) ?? false;
      const effectiveFollow =
        typeof should_follow === 'boolean' ? should_follow : !already;

      if (effectiveFollow && !already) {
        await User.updateOne(
          { _id: currentId },
          { $addToSet: { following: targetId }, $inc: { followingCount: 1 } },
          opts
        );
        await User.updateOne(
          { _id: targetId },
          { $addToSet: { followers: currentId }, $inc: { followersCount: 1 } },
          opts
        );
      } else if (!effectiveFollow && already) {
        await User.updateOne(
          { _id: currentId },
          { $pull: { following: targetId }, $inc: { followingCount: -1 } },
          opts
        );
        await User.updateOne(
          { _id: targetId },
          { $pull: { followers: currentId }, $inc: { followersCount: -1 } },
          opts
        );
      }

      let targetQuery = User.findById(targetId).select('followersCount');
      if (session) targetQuery = targetQuery.session(session);
      const targetAfter = await targetQuery.lean();

      let currentQuery = User.findById(currentId).select('following followingCount');
      if (session) currentQuery = currentQuery.session(session);
      const currentAfter = await currentQuery.lean();

      return {
        ok: true,
        data: {
          isFollowing: effectiveFollow,
          followersCount: Math.max(0, Number(targetAfter?.followersCount || 0)),
          followingIds: followingIdsFromUser(currentAfter),
          followingCount: Math.max(0, Number(currentAfter?.followingCount || 0)),
        },
      };
    };

    try {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const out = await runIntent(session);
        if (out.error) {
          await session.abortTransaction();
          return fail(res, out.error, out.status);
        }
        await session.commitTransaction();
        return ok(res, out.data);
      } catch (txErr) {
        await session.abortTransaction();
        throw txErr;
      } finally {
        session.endSession();
      }
    } catch (_transactionNotSupported) {
      const out = await runIntent(null);
      if (out.error) return fail(res, out.error, out.status);
      return ok(res, out.data);
    }
  } catch (err) {
    console.error('followUser error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

module.exports = {
  getProfile,
  updateProfile,
  uploadAvatar,
  getSavedParks,
  getPublicProfile,
  getUserProfile,
  getUserFollowing,
  followUser,
};
