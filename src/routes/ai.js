const express = require('express');
const router = express.Router();
const {
  stripThink,
  sanitizeCompletionBody,
  isOpen,
  recordSuccess,
  recordFailure,
  callUpstream,
  toOpenRouterModel,
} = require('../utils/aiProxy');

const semanticRouter = require('../utils/semanticRouter');

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// POST /api/ai/chat
// DeepSeek chat completions 代理（OpenAI 相容格式），API key 留伺服器端。
//
// 相較於最初的純轉發，這一版加了 manifest 的兩個 P0 任務：
//   P0-A  剝除 <think>…</think> 推理內容 + JSON 清理，避免 iOS JSONDecoder 崩潰。
//   P0-B  斷路器 + 優雅降級：DeepSeek 連續失敗/逾時 → 自動切 OpenRouter（若有設 key），
//         對 iOS 端完全透明。沒設 fallback key 時，原樣回傳 DeepSeek 的 status/body。
//
// 對外契約不變：成功時仍回傳 OpenAI 相容 JSON；429 的 Retry-After 原樣透傳。
router.post('/chat', async (req, res) => {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY; // 可選：未設則無 fallback
  if (!deepseekKey && !openrouterKey) {
    return res
      .status(503)
      .json({ error: 'No AI provider configured on server' });
  }

  const body = req.body || {};

  // 傳送成功回應：清理 <think> 後透傳 status / content-type / Retry-After。
  const sendCleaned = (result) => {
    res.status(result.status);
    res.set('Content-Type', result.contentType);
    if (result.retryAfter) res.set('Retry-After', result.retryAfter);
    return res.send(sanitizeCompletionBody(result.body));
  };

  // --- 主：DeepSeek（除非斷路器已打開）---
  const deepseekAvailable = deepseekKey && !isOpen('deepseek');
  if (deepseekAvailable) {
    try {
      const result = await callUpstream({ url: DEEPSEEK_URL, apiKey: deepseekKey, body });
      // 5xx 視為上游故障，計入斷路器；4xx（含 429）是正常業務回應，直接透傳。
      if (result.status >= 500) {
        recordFailure('deepseek');
      } else {
        recordSuccess('deepseek');
        return sendCleaned(result);
      }
    } catch (err) {
      // 網路錯誤 / 逾時（AbortError）
      recordFailure('deepseek');
      console.error(`[ai/chat] DeepSeek 失敗，嘗試 fallback：${err.message}`);
    }
  }

  // --- 備：OpenRouter（僅在有 key 時）---
  if (openrouterKey) {
    try {
      const orBody = { ...body, model: toOpenRouterModel(body.model) };
      const result = await callUpstream({
        url: OPENROUTER_URL,
        apiKey: openrouterKey,
        body: orBody,
        extraHeaders: {
          'HTTP-Referer': 'https://hikbik.app',
          'X-Title': 'HIKBIK',
        },
      });
      if (result.status >= 500) {
        recordFailure('openrouter');
      } else {
        recordSuccess('openrouter');
        return sendCleaned(result);
      }
    } catch (err) {
      recordFailure('openrouter');
      console.error(`[ai/chat] OpenRouter fallback 也失敗：${err.message}`);
    }
  }

  // 兩邊都不可用 → 對 iOS 回一個穩定的 503，而不是洩漏內部錯誤。
  return res
    .status(503)
    .json({ error: 'AI temporarily unavailable, please retry shortly' });
});

// POST /api/ai/match-route  (P0-C 語意路由攔截)
// body: { query: string, hub?: string, days?: number, threshold?: number }
//
// App 在呼叫 DeepSeek 生成「之前」先問這裡：
//   { matched:true, route:{route_id,...}, similarity } → App 直接載入該官方路線，不生成。
//   { matched:false }                                  → App 走原本的 DeepSeek 生成流程。
//
// 若後端未配置 Supabase/OpenAI（isConfigured=false），一律回 matched:false，
// App 行為與現在完全一致 —— 這個攔截是純加速層，永不擋路。
router.post('/match-route', async (req, res) => {
  const { query, hub, days, threshold } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query (string) is required' });
  }
  if (!semanticRouter.isConfigured()) {
    return res.json({ matched: false, reason: 'router-not-configured' });
  }
  try {
    const enriched = days ? `${query} (${days}-day trip)` : query;
    const result = await semanticRouter.routeIntent({
      query: enriched,
      hub: hub || null,
      threshold: typeof threshold === 'number' ? threshold : undefined,
    });
    return res.json(result);
  } catch (err) {
    // 攔截層出錯絕不能擋住生成 —— 回 matched:false，讓 App fallback 到 DeepSeek。
    console.error(`[ai/match-route] 失敗，降級為不攔截：${err.message}`);
    return res.json({ matched: false, reason: 'router-error' });
  }
});

module.exports = router;
