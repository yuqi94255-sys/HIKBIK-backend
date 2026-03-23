const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hikbik-dev-secret-change-in-production';

/**
 * 從請求取出 Bearer token（支援大小寫、多餘空白）
 * 標準：Authorization: Bearer <token>
 */
function getBearerToken(req) {
  let raw = req.headers.authorization || req.headers.Authorization;
  if (!raw || typeof raw !== 'string') {
    const x = req.headers['x-access-token'] || req.headers['X-Access-Token'];
    if (x && typeof x === 'string') return x.trim();
    return null;
  }
  raw = raw.trim();
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
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.warn('[auth] 401 JWT 驗證失敗:', err.message);
    return res.status(401).json({
      success: false,
      error: 'Token 無效或已過期',
      message: 'Token 無效或已過期',
    });
  }
}

module.exports = { verifyJWT, JWT_SECRET, getBearerToken };
