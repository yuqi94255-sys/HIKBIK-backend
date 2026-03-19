const rateLimit = require('express-rate-limit');

/**
 * 觸發限制時回傳 429 與統一 JSON：{ success: false, error }
 */
function limitReachedHandler(req, res) {
  res.status(429).json({
    success: false,
    error: '請求過於頻繁，請稍後再試',
    data: null,
    message: '請求過於頻繁，請稍後再試',
  });
}

/**
 * Auth 速率限制：登入、發送驗證碼等敏感接口
 * 每個 IP 每 15 分鐘最多 5 次請求
 */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: '請求過於頻繁，請稍後再試',
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitReachedHandler,
});

/**
 * Integration API 速率限制：/api/integration/ 所有接口
 * 每分鐘 100 次請求，防止第三方 API 額度被刷爆
 */
const integrationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: '請求過於頻繁，請稍後再試',
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitReachedHandler,
});

module.exports = {
  authRateLimiter,
  integrationRateLimiter,
};
