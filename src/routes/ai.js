const express = require('express');
const router = express.Router();

// POST /api/ai/chat
// DeepSeek chat completions 代理：body 原樣轉發（OpenAI 相容格式），
// API key 留在伺服器端（process.env.DEEPSEEK_API_KEY），永不下發到 app。
// 上游的 status / body / Retry-After 原樣回傳，讓 iOS 端的解析與 429 退避邏輯不變。
router.post('/chat', async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res
      .status(503)
      .json({ error: 'DEEPSEEK_API_KEY not configured on server' });
  }

  try {
    const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.set(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.set('Retry-After', retryAfter);
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: `DeepSeek proxy failed: ${err.message}` });
  }
});

module.exports = router;
