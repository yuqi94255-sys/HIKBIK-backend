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
 * 當前用戶關注 :id（Toggle：已關注則取消）
 */
async function followUser(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);
    const targetUserId = req.params?.id;
    if (!targetUserId || userId === targetUserId) return fail(res, '無效的目標用戶', 400);
    req.body = { ...(req.body || {}), targetUserId };
    const { toggleFollow } = require('./socialController');
    return toggleFollow(req, res);
  } catch (err) {
    console.error('followUser error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

module.exports = { getProfile, updateProfile, uploadAvatar, getPublicProfile, followUser };
