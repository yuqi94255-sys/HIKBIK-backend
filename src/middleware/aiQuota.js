// aiQuota.js — AI 端點的「登入 + 每日配額 + VIP 不限」守門。
//
// 目的：堵盜刷（沒登入不能燒 key）＋ 付費誘因（免費每日上限、VIP 無限）。
//
// ⚠️ 安全開關 AI_AUTH_REQUIRED：
//   預設「off」→ 完全放行（行為與現在一致），避免舊版 App（AI 呼叫還沒帶 JWT）全部 401。
//   等帶 JWT 的新 App 上線後，在 Render 設 AI_AUTH_REQUIRED=true 才開始強制。
//
// 免費每日次數：AI_FREE_DAILY（預設 8）。VIP（user.plan==='vip'）不限。

const { verifyJWT } = require('./authMiddleware');
const User = require('../models/User');

const AUTH_REQUIRED = process.env.AI_AUTH_REQUIRED === 'true';
const FREE_DAILY = Number(process.env.AI_FREE_DAILY || 8);

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function enforceQuota(req, res, next) {
  try {
    const user = await User.findById(req.user && req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    if (user.plan === 'vip') return next(); // VIP 不限

    const today = todayStr();
    const used = user.aiUsage && user.aiUsage.date === today ? (user.aiUsage.count || 0) : 0;
    if (used >= FREE_DAILY) {
      return res.status(429).json({
        error: `Daily AI limit reached (${FREE_DAILY}/day). Upgrade for unlimited.`,
        code: 'AI_QUOTA_EXCEEDED',
        upgrade: true,
      });
    }
    user.aiUsage = { date: today, count: used + 1 };
    await user.save();
    return next();
  } catch (err) {
    // 配額系統本身故障，不該擋住付費用戶用產品 → 放行，只記錄。
    console.error(`[aiQuota] 配額檢查失敗，放行：${err.message}`);
    return next();
  }
}

function aiQuota(req, res, next) {
  if (!AUTH_REQUIRED) return next(); // 開關未開 → 照舊放行
  // 先驗 JWT（掛 req.user），通過才進配額檢查
  return verifyJWT(req, res, () => enforceQuota(req, res, next));
}

module.exports = aiQuota;
