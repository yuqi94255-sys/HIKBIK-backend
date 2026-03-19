const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/authMiddleware');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const OTP_TTL_MS = 5 * 60 * 1000; // 5 分鐘

// DB 不可用時的臨時存儲（避免主流程崩潰）
const memoryUsers = new Map(); // email -> { id, verification_code, verification_code_expires, is_verified }

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function getEmailSafe(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
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

  // 寫入 DB（同時保留舊欄位 otp/otpExpires 相容既有邏輯）
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
    // DB 不可用時：至少確保可以發送並驗證（避免服務崩潰）
    const existing = memoryUsers.get(safeEmail);
    const id = existing?.id || `user-mock-${Date.now()}`;
    memoryUsers.set(safeEmail, {
      id,
      verification_code: code,
      verification_code_expires: expiresAt,
      is_verified: false,
    });
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
      <h2 style="color: #333;">HIKBIK 安全驗證碼</h2>
      <p>您的驗證碼為：<strong style="font-size: 24px; letter-spacing: 4px;">${code}</strong></p>
      <p style="color: #666;">此驗證碼 <strong>5 分鐘內有效</strong>，請勿轉發給他人。</p>
      <p style="color: #999; font-size: 12px;">若您未請求此驗證碼，請忽略本郵件。</p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: 'HIKBIK <onboarding@resend.dev>',
    to: [safeEmail],
    subject: 'HIKBIK 安全驗證碼',
    html,
  });

  if (error) {
    throw Object.assign(new Error('發送驗證碼失敗'), { status: 500 });
  }

  console.log(`驗證碼已發送至 ${safeEmail}`);
  return { email: safeEmail };
}

async function verifyVerificationCode(email, code) {
  const safeEmail = getEmailSafe(email);
  if (!safeEmail || !code) {
    throw Object.assign(new Error('請提供 email 與 code'), { status: 400 });
  }

  const inputCode = String(code).trim();

  let user = null;
  try {
    user = await User.findOne({ email: safeEmail });
  } catch (err) {
    user = null;
  }

  // 從 DB 或 memory 取驗證碼
  const storedCode =
    user?.verification_code ??
    user?.otp ??
    memoryUsers.get(safeEmail)?.verification_code ??
    null;

  const storedExpires =
    user?.verification_code_expires ??
    user?.otpExpires ??
    memoryUsers.get(safeEmail)?.verification_code_expires ??
    null;

  if (!storedCode || !storedExpires) {
    throw Object.assign(new Error('驗證碼無效或已使用'), { status: 401 });
  }
  if (new Date() > storedExpires) {
    // 成功過期也要清理避免重複使用
    try {
      await User.updateOne(
        { email: safeEmail },
        { $unset: { verification_code: 1, verification_code_expires: 1, otp: 1, otpExpires: 1 } }
      );
    } catch (_) {}
    memoryUsers.delete(safeEmail);
    throw Object.assign(new Error('驗證碼已過期'), { status: 401 });
  }
  if (String(storedCode) !== inputCode) {
    throw Object.assign(new Error('驗證碼錯誤'), { status: 401 });
  }

  // 驗證成功後清理碼並發 token
  let userId = null;
  try {
    if (user && user._id) {
      userId = user._id.toString();
      await User.updateOne(
        { email: safeEmail },
        {
          $unset: {
            verification_code: 1,
            verification_code_expires: 1,
            otp: 1,
            otpExpires: 1,
          },
          $set: { is_verified: true },
        }
      );
    }
  } catch (_) {}

  if (!userId) {
    userId = memoryUsers.get(safeEmail)?.id || `user-mock-${Date.now()}`;
    memoryUsers.delete(safeEmail);
  }

  const token = generateToken({ id: userId }, '7d');
  const userPayload = {
    id: userId,
    nickname: user?.nickname ?? 'Explorer',
    avatarUrl: user?.avatarUrl ?? '',
    bio: user?.bio ?? '',
    followingCount: user?.followingCount ?? 0,
    followersCount: user?.followersCount ?? 0,
    totalDistanceMeters: user?.totalDistanceMeters ?? 0,
    isVerified: true,
  };

  return { token, userPayload };
}

module.exports = {
  sendVerificationCode,
  verifyVerificationCode,
};

