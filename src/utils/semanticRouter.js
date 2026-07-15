// semanticRouter.js — P0-C 語意路由攔截。
//
// 用戶要「生成一趟旅程」時，先把意圖 embed，去 Supabase routes 表做向量相似度搜尋。
// 若有官方路線夠像（>= 門檻）→ 回傳它，App 直接載入現成 curated 路線，完全不呼叫 DeepSeek。
// 不夠像 → 回 { matched:false }，App 走原本的 DeepSeek 生成流程。
//
// 目的：把「California Highway 1 chill vibe」這類明確意圖攔截到 1000+ 官方路線，
//       省掉一次昂貴的生成呼叫，也讓別人抄不走這批 curated 內容。
//
// 依賴：只用 Node 內建 fetch（Node 18+），不引入 supabase-js / openai SDK。
// 需要的環境變數：SUPABASE_URL、SUPABASE_KEY（anon 即可，僅讀）、OPENAI_API_KEY。

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const OPENAI_MODEL = 'text-embedding-3-small';

// 相似度門檻：低於此值不攔截，交給 DeepSeek 生成。
// ⚠️ 實測校準（text-embedding-3-small）：完美命中僅約 0.65，對題約 0.53。
// 故門檻設 0.60 —— 攔得住強命中、又不會誤攔弱相關。可用 AI_MATCH_THRESHOLD 環境變數微調。
// 上線後應 log 實際 similarity 分佈再收斂這個值。
const DEFAULT_THRESHOLD = Number(process.env.AI_MATCH_THRESHOLD || 0.60);

function isConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_KEY &&
    process.env.OPENAI_API_KEY
  );
}

// 把用戶意圖轉成向量。
async function embedQuery(text) {
  const resp = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: OPENAI_MODEL, input: text }),
  });
  if (!resp.ok) {
    throw new Error(`OpenAI embed ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  return json.data[0].embedding; // number[]
}

// 呼叫 Supabase 的 match_routes RPC。
async function matchRoutes({ embedding, matchCount = 5, hub = null, threshold = DEFAULT_THRESHOLD }) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/match_routes`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // vector 型別以文字形式傳最穩：'[0.1,0.2,...]'
      query_embedding: `[${embedding.join(',')}]`,
      match_count: matchCount,
      similarity_threshold: threshold,
      filter_hub: hub,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Supabase match_routes ${resp.status}: ${await resp.text()}`);
  }
  return resp.json(); // [{route_id, hub, title, tagline, est_days, similarity}]
}

// 一站式：意圖字串 → 最佳官方路線 or null。
// 回傳 { matched, route?, similarity?, candidates? }。
async function routeIntent({ query, hub = null, threshold = DEFAULT_THRESHOLD, matchCount = 5 }) {
  const embedding = await embedQuery(query);
  const rows = await matchRoutes({ embedding, matchCount, hub, threshold });
  if (!rows || rows.length === 0) {
    return { matched: false, candidates: [] };
  }
  const best = rows[0];
  return {
    matched: best.similarity >= threshold,
    route: best,
    similarity: best.similarity,
    candidates: rows,
  };
}

module.exports = { isConfigured, embedQuery, matchRoutes, routeIntent, DEFAULT_THRESHOLD };
