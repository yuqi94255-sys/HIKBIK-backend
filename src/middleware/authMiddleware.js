const jwt = require('jsonwebtoken');

const DEV_FALLBACK_SECRET = 'hikbik-dev-secret-change-in-production';

/**
 * 每次簽發／驗證時讀取，避免僅在模組載入時讀一次 env（與 Render 注入時序無關，但可確保 trim 一致）。
 * 生產環境請在 Render（或主機）設定固定 JWT_SECRET，勿隨部署變動，否則舊 Token 會 invalid signature。
 */
function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (typeof s === 'string' && s.trim()) return s.trim();
  return DEV_FALLBACK_SECRET;
}

/**
 * 從請求取出 Bearer token。
 * 1) 標準 Authorization: Bearer <token> — 以空白 split 後取 [1]（與前端慣例一致）
 * 2) 多個連續空白時改用 /\s+/ 切分，避免 split(' ')[1] 拿到空字串
 * 3) 後備：X-Access-Token 標頭
 */
function getBearerToken(req) {
  let raw = req.headers.authorization || req.headers.Authorization;
  if (!raw || typeof raw !== 'string') {
    const x = req.headers['x-access-token'] || req.headers['X-Access-Token'];
    if (x && typeof x === 'string') return x.trim();
    return null;
  }
  raw = raw.trim();

  const parts = raw.split(/\s+/);
  if (parts.length >= 2 && /^bearer$/i.test(parts[0])) {
    return parts.slice(1).join(' ').trim() || null;
  }

  const spaceParts = raw.split(' ');
  if (spaceParts.length >= 2 && /^bearer$/i.test(spaceParts[0])) {
    const token = spaceParts[1];
    if (token) return token.trim();
  }

  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : null;
}

/**
 * 驗證 JWT，將解碼後的 payload 掛到 req.user
 */
function verifyJWT(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    console.warn(
      '[auth] 401 缺少 Authorization: Bearer <token>，收到 headers:',
      JSON.stringify(req.headers && { ...req.headers, authorization: req.headers.authorization ? '[present]' : '[missing]' })
    );
    return res.status(401).json({
      success: false,
      error: '缺少或無效的 Authorization 標頭（請使用 Authorization: Bearer <token>）',
      message: '缺少或無效的 Authorization 標頭（請使用 Authorization: Bearer <token>）',
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    console.log('JWT 驗證失敗原因:', err.message);
    return res.status(401).json({
      success: false,
      error: 'Token 無效或已過期',
      message: 'Token 無效或已過期',
    });
  }
}

/**
 * 有 Bearer 且驗證通過時掛 req.user；無 Token 或 Token 無效時不報錯（供公開列表帶 isLiked 等）
 */
function optionalVerifyJWT(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    req.user = undefined;
    return next();
  }
  try {
    req.user = jwt.verify(token, getJwtSecret());
  } catch (_err) {
    req.user = undefined;
  }
  next();
}

module.exports = { verifyJWT, optionalVerifyJWT, getJwtSecret, getBearerToken };
