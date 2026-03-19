const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { JWT_SECRET } = require('../middleware/authMiddleware');
const User = require('../models/User');
const { sendVerificationCode, verifyVerificationCode } = require('../services/authService');

// ---------------------------------------------------------------------------
// 從 .env 讀取 OAuth 憑證（申請到憑證後在 .env 填寫）
// ---------------------------------------------------------------------------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
// resend 在 src/services/authService.js 初始化
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const APPLE_KEY_ID = process.env.APPLE_KEY_ID;
const APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY; // 或 .p8 內容
const APPLE_REDIRECT_URI = process.env.APPLE_REDIRECT_URI;

// ---------------------------------------------------------------------------
// Mock 存儲（正式環境改為 DB，Email 註冊/登錄仍用於兼容）
// ---------------------------------------------------------------------------
const mockUsers = new Map(); // email -> { email, passwordHash, name, id }

function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// ---------------------------------------------------------------------------
// checkEmail：GET /api/auth/check-email?email=xxx（AuthService 對接）
// ---------------------------------------------------------------------------
async function checkEmail(req, res) {
  const email = req.query?.email?.trim();
  if (!email) {
    return res.status(400).json({
      success: false,
      data: null,
      error: '請提供 email 參數',
      message: '請提供 email 參數',
    });
  }
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    return res.json({
      success: true,
      data: { registered: !!user },
      message: '',
    });
  } catch (err) {
    console.error('checkEmail error:', err);
    return res.status(503).json({
      success: false,
      data: null,
      error: '服務暫時不可用',
      message: '服務暫時不可用',
    });
  }
}

// ---------------------------------------------------------------------------
// verifyGoogle：接收前端傳來的 id_token，驗證並回傳用戶資訊
// 有 GOOGLE_CLIENT_ID 時用 Google 官方驗證，否則走 Mock（開發用）
// ---------------------------------------------------------------------------
async function verifyGoogle(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return null;
  }

  if (GOOGLE_CLIENT_ID) {
    try {
      const client = new OAuth2Client(GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub) return null;
      return {
        googleId: payload.sub,
        email: payload.email || null,
        name: payload.name || payload.email || 'Google User',
      };
    } catch (err) {
      return null;
    }
  }

  // 未配置憑證時：僅開發用 Mock（解碼 payload，不驗證簽名）
  try {
    const decoded = jwt.decode(idToken);
    if (decoded && decoded.sub) {
      return {
        googleId: decoded.sub,
        email: decoded.email || `google-${decoded.sub}@mock.hikbik.com`,
        name: decoded.name || decoded.email || 'Google User',
      };
    }
  } catch (_) {}
  return {
    googleId: `google-${Date.now()}`,
    email: `google-${Date.now()}@mock.hikbik.com`,
    name: 'Google User',
  };
}

// ---------------------------------------------------------------------------
// verifyApple：接收前端傳來的 Apple 授權碼 (authorization code)，換 token 並取得用戶
// 有 Apple 憑證時用 Apple API 換碼，否則走 Mock（開發用）
// 前端亦可傳 identity_token + user（首次的 email/name），此函數預留授權碼流程
// ---------------------------------------------------------------------------
async function verifyApple(authorizationCode, clientSideUser = null) {
  if (APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY && authorizationCode) {
    try {
      // TODO: 取得 Apple 的 access_token / id_token（需用 APPLE_PRIVATE_KEY 簽 client_secret）
      // 參考：https://developer.apple.com/documentation/sign_in_with_apple/generating_a_client_secret
      // const clientSecret = generateAppleClientSecret();
      // const tokenResponse = await exchangeCodeForTokens(authorizationCode, clientSecret, APPLE_REDIRECT_URI);
      // const idToken = tokenResponse.id_token;
      // const decoded = decodeAppleIdToken(idToken);
      // return { appleId: decoded.sub, email: decoded.email || null, name: null };
      const _ = { APPLE_REDIRECT_URI };
      return null; // 憑證齊全但尚未實作換碼時可先回 null，底下會用 clientSideUser
    } catch (err) {
      return null;
    }
  }

  // 未配置憑證或僅傳 identity_token + user：Mock 或依前端帶來的 user
  const appleId = `apple-${Date.now()}`;
  return {
    appleId,
    email: clientSideUser?.email || `apple-${appleId}@mock.hikbik.com`,
    name: clientSideUser?.name || 'Apple User',
  };
}

// ---------------------------------------------------------------------------
// sendOTP：接收 Email，生成 6 位驗證碼並透過 Resend 發送
// ---------------------------------------------------------------------------
async function sendOTP(req, res) {
  const email = req.body?.email?.trim();
  if (!email) {
    return res.status(400).json({
      success: false,
      data: null,
      error: '請提供 email',
      message: '請提供 email',
    });
  }

  try {
    await sendVerificationCode(email);
    const safeEmail = email.toLowerCase();
    return res.json({
      success: true,
      data: { email: safeEmail },
      message: '',
    });
  } catch (err) {
    const status = Number(err.status) || 503;
    const msg = err.message || '發送驗證碼失敗';
    return res.status(status).json({
      success: false,
      data: null,
      error: msg,
      message: msg,
    });
  }
}

// ---------------------------------------------------------------------------
// verifyOTP：比對驗證碼，通過後簽發 JWT 並清除驗證碼
// ---------------------------------------------------------------------------
async function verifyOTP(req, res) {
  const email = req.body?.email?.trim();
  const code = req.body?.code?.trim();
  if (!email || !code) {
    return res.status(400).json({
      success: false,
      data: null,
      error: '請提供 email 與 code',
      message: '請提供 email 與 code',
    });
  }

  try {
    const { token, userPayload } = await verifyVerificationCode(email, code);
    return res.json({
      success: true,
      data: { token, user: userPayload },
      message: '',
      token,
      user: userPayload,
    });
  } catch (err) {
    const status = Number(err.status) || 401;
    const msg = err.message || '驗證失敗';
    return res.status(status).json({
      success: false,
      data: null,
      error: msg,
      message: msg,
    });
  }
}

// ---------------------------------------------------------------------------
// Google 登錄：接收前端 id_token，呼叫 verifyGoogle 後發 JWT
// ---------------------------------------------------------------------------
async function googleLogin(req, res) {
  const { id_token } = req.body;
  if (!id_token) {
    return res.status(400).json({
      success: false,
      data: null,
      error: '請提供 id_token',
      message: '請提供 id_token',
    });
  }

  const googleUser = await verifyGoogle(id_token);
  if (!googleUser) {
    return res.status(401).json({
      success: false,
      data: null,
      error: 'Google 驗證失敗',
      message: 'Google 驗證失敗',
    });
  }

  const userId = `user-${googleUser.googleId}`;
  const token = generateToken({ id: userId, email: googleUser.email, provider: 'google' });
  return res.json({
    success: true,
    data: {
      token,
      user: {
        id: userId,
        email: googleUser.email,
        name: googleUser.name,
        provider: 'google',
      },
    },
    message: '',
    token,
    user: {
      id: userId,
      email: googleUser.email,
      name: googleUser.name,
      provider: 'google',
    },
  });
}

// ---------------------------------------------------------------------------
// Apple 登錄：支援授權碼 (code) 或 前端 identity_token + user
// ---------------------------------------------------------------------------
async function appleLogin(req, res) {
  const { code, id_token: appleIdToken, user: appleUser } = req.body;
  const authorizationCode = code || null;

  // 優先授權碼流程；若無則用 identity_token + 前端傳的 user（Mock / 之後可改為驗證 identity_token）
  let appleData = await verifyApple(authorizationCode, appleUser);
  if (!appleData && (appleIdToken || appleUser)) {
    appleData = await verifyApple(null, appleUser);
  }
  if (!appleData) {
    return res.status(401).json({
      success: false,
      data: null,
      error: 'Apple 驗證失敗',
      message: 'Apple 驗證失敗',
    });
  }

  const userId = `user-${appleData.appleId}`;
  const token = generateToken({ id: userId, email: appleData.email, provider: 'apple' });
  return res.json({
    success: true,
    data: {
      token,
      user: {
        id: userId,
        email: appleData.email,
        name: appleData.name,
        provider: 'apple',
      },
    },
    message: '',
    token,
    user: {
      id: userId,
      email: appleData.email,
      name: appleData.name,
      provider: 'apple',
    },
  });
}

// ---------------------------------------------------------------------------
// Email 註冊
// ---------------------------------------------------------------------------
async function register(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      data: null,
      error: '請提供 email 與 password',
      message: '請提供 email 與 password',
    });
  }
  const safeEmail = email.toLowerCase();

  try {
    const existing = await User.findOne({ email: safeEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        data: null,
        error: '該 email 已註冊',
        message: '該 email 已註冊',
      });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const user = await User.create({
      email: safeEmail,
      nickname: name || safeEmail,
      password: passwordHash,
      is_verified: false,
    });

    const token = generateToken({ id: user._id.toString(), email: user.email, provider: 'email' });
    const userPayload = {
      id: user._id.toString(),
      email: user.email,
      name: user.nickname,
      provider: 'email',
    };

    return res.status(201).json({
      success: true,
      data: { token, user: userPayload },
      message: '',
      token,
      user: userPayload,
    });
  } catch (err) {
    // DB 不可用時：回退到 mock（維持開發流程不阻塞）
    if (mockUsers.has(safeEmail)) {
      return res.status(409).json({
        success: false,
        data: null,
        error: '該 email 已註冊',
        message: '該 email 已註冊',
      });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const id = `user-email-${Date.now()}`;
    mockUsers.set(safeEmail, { id, email: safeEmail, passwordHash, name: name || safeEmail });

    const token = generateToken({ id, email: safeEmail, provider: 'email' });
    const userPayload = { id, email: safeEmail, name: name || safeEmail, provider: 'email' };
    return res.status(201).json({
      success: true,
      data: { token, user: userPayload },
      message: '',
      token,
      user: userPayload,
    });
  }
}

// ---------------------------------------------------------------------------
// Email 登錄
// ---------------------------------------------------------------------------
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      data: null,
      error: '請提供 email 與 password',
      message: '請提供 email 與 password',
    });
  }
  const safeEmail = email.toLowerCase();

  try {
    const user = await User.findOne({ email: safeEmail });
    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        data: null,
        error: '帳號或密碼錯誤',
        message: '帳號或密碼錯誤',
      });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({
        success: false,
        data: null,
        error: '帳號或密碼錯誤',
        message: '帳號或密碼錯誤',
      });
    }

    const token = generateToken({ id: user._id.toString(), email: user.email, provider: 'email' });
    const userPayload = {
      id: user._id.toString(),
      email: user.email,
      name: user.nickname,
      provider: 'email',
    };
    return res.json({
      success: true,
      data: { token, user: userPayload },
      message: '',
      token,
      user: userPayload,
    });
  } catch (err) {
    // DB 不可用：回退到 mock
    const mockUser = mockUsers.get(safeEmail);
    if (!mockUser) {
      return res.status(401).json({
        success: false,
        data: null,
        error: '帳號或密碼錯誤',
        message: '帳號或密碼錯誤',
      });
    }

    const valid = await bcrypt.compare(password, mockUser.passwordHash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        data: null,
        error: '帳號或密碼錯誤',
        message: '帳號或密碼錯誤',
      });
    }

    const token = generateToken({ id: mockUser.id, email: mockUser.email, provider: 'email' });
    const userPayload = {
      id: mockUser.id,
      email: mockUser.email,
      name: mockUser.name,
      provider: 'email',
    };
    return res.json({
      success: true,
      data: { token, user: userPayload },
      message: '',
      token,
      user: userPayload,
    });
  }
}

// ---------------------------------------------------------------------------
// 獲取當前用戶（需 JWT）
// ---------------------------------------------------------------------------
function me(req, res) {
  return res.json({
    success: true,
    data: { user: req.user },
    message: '',
  });
}

module.exports = {
  verifyGoogle,
  verifyApple,
  sendOTP,
  verifyOTP,
  checkEmail,
  googleLogin,
  appleLogin,
  register,
  login,
  me,
};
