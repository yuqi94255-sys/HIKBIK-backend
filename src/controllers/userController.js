const mongoose = require('mongoose');
const User = require('../models/User');
const { ok, fail } = require('../utils/response');
const { keysToSnakeCase } = require('../utils/snakeCase');

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
    followingCount: user.followingCount ?? 0,
    followersCount: user.followersCount ?? 0,
    totalDistanceMeters: user.totalDistanceMeters ?? 0,
  };
}

const ALLOWED_PROFILE_FIELDS = ['firstName', 'lastName', 'nickname', 'bio', 'avatarUrl'];
const NICKNAME_MIN = 1;
const NICKNAME_MAX = 30;
const BIO_MAX = 500;
const AVATAR_URL_MAX = 2048;

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

/**
 * GET /api/users/:id/following
 * 回傳該用戶關注列表（populate nickname、avatarUrl 等，非純 ObjectId）
 */
async function getUserFollowing(req, res) {
  try {
    const id = req.params?.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, '無效的用戶 id', 400);
    }

    const user = await User.findById(id)
      .select('following')
      .populate({
        path: 'following',
        select: 'nickname avatarUrl bio firstName lastName',
      })
      .lean();

    if (!user) return fail(res, '用戶不存在', 404);

    const raw = Array.isArray(user.following) ? user.following : [];
    const items = raw
      .map((u) => {
        if (!u || u._id == null) return null;
        const avatarUrl = u.avatarUrl != null ? String(u.avatarUrl) : '';
        return {
          id: u._id.toString(),
          nickname: u.nickname != null ? String(u.nickname) : 'Explorer',
          avatarUrl,
          /** 與部分前端 profileImage 命名對齊，值同 avatarUrl */
          profileImage: avatarUrl,
          bio: u.bio != null ? String(u.bio) : '',
          firstName: u.firstName != null ? String(u.firstName) : '',
          lastName: u.lastName != null ? String(u.lastName) : '',
        };
      })
      .filter(Boolean);

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
 * 依實際 following / followers 陣列長度寫回計數，並回傳當前是否關注與對方粉絲數。
 */
async function syncFollowRelationCounts(currentId, targetId, session) {
  const opts = session ? { session } : {};

  let qCur = User.findById(currentId).select('following');
  let qTar = User.findById(targetId).select('followers');
  if (session) {
    qCur = qCur.session(session);
    qTar = qTar.session(session);
  }
  const [curLean, tarLean] = await Promise.all([qCur.lean(), qTar.lean()]);

  const followingArr = Array.isArray(curLean?.following) ? curLean.following : [];
  const followersArr = Array.isArray(tarLean?.followers) ? tarLean.followers : [];

  await User.updateOne(
    { _id: currentId },
    { $set: { followingCount: followingArr.length } },
    opts
  );
  await User.updateOne(
    { _id: targetId },
    { $set: { followersCount: followersArr.length } },
    opts
  );

  const isFollowing = followingArr.some((f) => f.equals(targetId));
  return { isFollowing, followerCount: followersArr.length };
}

/**
 * POST /api/users/:id/follow
 * Body: { shouldFollow: boolean }（可選 should_follow）
 * 冪等：目標狀態已達成則不變更陣列，仍 200；計數一律依陣列長度重算。
 */
async function followUser(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const rawShould = req.body?.shouldFollow ?? req.body?.should_follow;
    if (typeof rawShould !== 'boolean') {
      return fail(
        res,
        '請提供 shouldFollow（boolean）：true 為關注、false 為取消關注',
        400
      );
    }
    const shouldFollow = rawShould;

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
      `[Follow Action] User ${req.user.id} shouldFollow=${shouldFollow} target ${req.params.id}`
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

      if (shouldFollow && !already) {
        await User.updateOne({ _id: currentId }, { $addToSet: { following: targetId } }, opts);
        await User.updateOne({ _id: targetId }, { $addToSet: { followers: currentId } }, opts);
      } else if (!shouldFollow && already) {
        await User.updateOne({ _id: currentId }, { $pull: { following: targetId } }, opts);
        await User.updateOne({ _id: targetId }, { $pull: { followers: currentId } }, opts);
      }

      const result = await syncFollowRelationCounts(currentId, targetId, session);
      return { ok: true, data: result };
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
  getPublicProfile,
  getUserProfile,
  getUserFollowing,
  followUser,
};
