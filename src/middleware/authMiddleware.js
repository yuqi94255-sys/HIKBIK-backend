const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hikbik-dev-secret-change-in-production';

/**
 * 驗證 JWT，將解碼後的 payload 掛到 req.user
 * Authorization: Bearer <token>
 */
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '缺少或無效的 Authorization 標頭' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token 無效或已過期' });
  }
}

module.exports = { verifyJWT, JWT_SECRET };
