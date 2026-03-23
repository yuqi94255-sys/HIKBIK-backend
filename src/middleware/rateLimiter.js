/**
 * 老闆指令（測試期）：徹底關閉 express-rate-limit，避免任何 429。
 * 若日後要恢復限流，取消下方註解並改回使用 rateLimit()。
 */
// const rateLimit = require('express-rate-limit');

/** 空 middleware：不計數、不攔截 */
function noopLimiter(req, res, next) {
  next();
}

/*
const limitReachedHandler = (req, res) => {
  res.status(429).json({
    success: false,
    error: '請求過於頻繁，請稍後再試',
    data: null,
    message: '請求過於頻繁，請稍後再試',
  });
};

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: limitReachedHandler,
});

const integrationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  handler: limitReachedHandler,
});
*/

const authRateLimiter = noopLimiter;
const integrationRateLimiter = noopLimiter;

module.exports = {
  authRateLimiter,
  integrationRateLimiter,
};
