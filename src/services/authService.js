const crypto = require('crypto');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../middleware/authMiddleware');

/** 與 Resend 控制台 API Key 一致；環境變數名必須為 RESEND_API_KEY（值形如 re_asNjxfQ6...） */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/** 可選：REDIS_URL 存在時將 OTP 同步寫入 Redis（與 MongoDB 雙寫，驗證時優先以持久層為準） */
let redisClient = null;
function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redisClient) {
    // eslint-disable-next-line global-require
    const Redis = require('ioredis');
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  }
  return redisClient;
}

function otpRedisKey(email) {
  return `hikbik:otp:${email}`;
}

async function setOtpRedis(safeEmail, code, ttlSec) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(otpRedisKey(safeEmail), code, 'EX', Math.max(1, ttlSec));
  } catch (e) {
    console.error('Redis SET OTP 失敗:', e);
  }
}

async function getOtpRedis(safeEmail) {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(otpRedisKey(safeEmail));
  } catch (e) {
    console.error('Redis GET OTP 失敗:', e);
    return null;
  }
}

async function delOtpRedis(safeEmail) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(otpRedisKey(safeEmail));
  } catch (e) {
    console.error('Redis DEL OTP 失敗:', e);
  }
}

function stringifyResendPayload(payload) {
  if (payload == null) return 'null';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 分鐘

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

function getEmailSafe(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** 與老闆指令對齊：比對失敗（錯誤／過期／無記錄） */
function throwInvalidCode() {
  const e = new Error('Invalid code');
  e.status = 400;
  e.invalidCode = true;
  throw e;
}

/**
 * 以相同長度做常數時間比對，降低時序攻擊風險（6 位數字）
 */
function safeEqualCodes(a, b) {
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (sa.length !== sb.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sa, 'utf8'), Buffer.from(sb, 'utf8'));
  } catch {
    return false;
  }
}

async function sendVerificationCode(email) {
  const safeEmail = getEmailSafe(email);
  if (!safeEmail) {
    throw Object.assign(new Error('請提供 email'), { status: 400 });
  }

  if (!resend) {
    throw Object.assign(new Error('郵件服務未配置（請設定 RESEND_API_KEY）'), {
      status: 503,
    });
  }

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const ttlSec = Math.ceil(OTP_TTL_MS / 1000);

  // 真實驗證碼必須落在 MongoDB（主存儲）；可選同步 Redis
  try {
    await User.findOneAndUpdate(
      { email: safeEmail },
      {
        $set: {
          verification_code: code,
          verification_code_expires: expiresAt,
          is_verified: false,
          otp: code,
          otpExpires: expiresAt,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('sendVerificationCode MongoDB 寫入失敗:', err);
    throw Object.assign(new Error('無法儲存驗證碼，請稍後再試'), { status: 503 });
  }

  await setOtpRedis(safeEmail, code, ttlSec);

  const html = `
    <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
      <h2 style="color: #333;">HIKBIK 安全驗證碼</h2>
      <p>您的驗證碼為：<strong style="font-size: 24px; letter-spacing: 4px;">${code}</strong></p>
      <p style="color: #666;">此驗證碼 <strong>5 分鐘內有效</strong>，請勿轉發給他人。</p>
      <p style="color: #999; font-size: 12px;">若您未請求此驗證碼，請忽略本郵件。</p>
    </div>
  `;

  console.log('正在嘗試發送郵件到:', safeEmail);

  let sendResult;
  try {
    sendResult = await resend.emails.send({
      from: 'HIKBIK <onboarding@resend.dev>',
      to: [safeEmail],
      subject: 'HIKBIK 安全驗證碼',
      html,
    });
  } catch (err) {
    console.error('Resend emails.send 拋出異常:', err);
    const msg = err?.message || stringifyResendPayload(err);
    throw Object.assign(new Error(msg), {
      status: Number(err?.statusCode) || 502,
      cause: err,
    });
  }

  const { data, error } = sendResult || {};

  if (error) {
    console.error('Resend emails.send 回傳錯誤:', error);
    const msg = stringifyResendPayload(error);
    const status =
      Number(error.statusCode) && Number(error.statusCode) >= 400
        ? Number(error.statusCode)
        : 502;
    throw Object.assign(new Error(msg), { status, resendError: error });
  }

  if (!data || !data.id) {
    const bad = stringifyResendPayload(sendResult);
    console.error('Resend 回應異常（預期含 data.id）:', bad);
    throw Object.assign(new Error(bad), { status: 502 });
  }

  console.log(`驗證碼已發送至 ${safeEmail}（Resend email id: ${data.id}）`);
  return { email: safeEmail };
}

/**
 * 僅從 MongoDB（及可選 Redis 鏡像）讀取該 email 的真實驗證碼並比對。
 * 比對失敗拋出 invalidCode（由控制器轉為 400 + Invalid code）。
 */
async function verifyVerificationCode(email, code) {
  const safeEmail = getEmailSafe(email);
  if (!safeEmail || !code) {
    throw Object.assign(new Error('請提供 email 與 code'), {
      status: 400,
      missingBody: true,
    });
  }

  const inputCode = String(code).trim();

  let user = null;
  try {
    user = await User.findOne({ email: safeEmail });
  } catch (err) {
    console.error('verifyVerificationCode MongoDB 讀取失敗:', err);
    throw Object.assign(new Error('驗證服務暫時不可用'), { status: 503 });
  }

  const redisCode = await getOtpRedis(safeEmail);

  const mongoCode = user?.verification_code ?? user?.otp ?? null;
  const mongoExpires = user?.verification_code_expires ?? user?.otpExpires ?? null;

  const hasMongoCode = mongoCode != null && String(mongoCode).trim() !== '';
  // 真實存儲：優先 MongoDB；未寫入欄位時使用 Redis 鏡像（兩者皆來自 send-otp，非記憶體 Map）
  const storedCode = hasMongoCode ? mongoCode : redisCode;

  if (storedCode == null || storedCode === '') {
    throwInvalidCode();
  }

  if (mongoExpires && new Date() > new Date(mongoExpires)) {
    try {
      await User.updateOne(
        { email: safeEmail },
        { $unset: { verification_code: 1, verification_code_expires: 1, otp: 1, otpExpires: 1 } }
      );
    } catch (_) {}
    await delOtpRedis(safeEmail);
    throwInvalidCode();
  }

  if (!safeEqualCodes(storedCode, inputCode)) {
    throwInvalidCode();
  }

  // 更新前狀態：用於前端判斷「填名字」vs「進首頁」
  const fnPre = String(user?.firstName ?? '').trim();
  const lnPre = String(user?.lastName ?? '').trim();
  const isExistingUser =
    (fnPre !== '' && lnPre !== '') ||
    Boolean(user?.password) ||
    user?.is_verified === true;

  // 驗證成功：清除 Mongo 與 Redis 中的 OTP
  let updated;
  try {
    updated = await User.findOneAndUpdate(
      { email: safeEmail },
      {
        $unset: {
          verification_code: 1,
          verification_code_expires: 1,
          otp: 1,
          otpExpires: 1,
        },
        $set: { is_verified: true },
      },
      { new: true }
    );
  } catch (err) {
    console.error('verifyVerificationCode 清除驗證碼失敗:', err);
    throw Object.assign(new Error('無法完成驗證，請稍後再試'), { status: 503 });
  }

  await delOtpRedis(safeEmail);

  if (!updated?._id) {
    throw Object.assign(new Error('無法完成驗證'), { status: 503 });
  }

  const userId = updated._id.toString();
  const token = generateToken({ id: userId }, '7d');
  const userPayload = {
    id: userId,
    firstName: updated.firstName ?? '',
    lastName: updated.lastName ?? '',
    nickname: updated.nickname ?? 'Explorer',
    avatarUrl: updated.avatarUrl ?? '',
    bio: updated.bio ?? '',
    followingCount: updated.followingCount ?? 0,
    followersCount: updated.followersCount ?? 0,
    totalDistanceMeters: updated.totalDistanceMeters ?? 0,
    isVerified: true,
    isExistingUser,
  };

  return { token, userPayload, isExistingUser };
}

module.exports = {
  sendVerificationCode,
  verifyVerificationCode,
};
