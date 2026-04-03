// 必須最先執行：確保 .env 在所有數據庫/配置調用之前載入
require('dotenv').config();

const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./src/config/db');

const productsRouter = require('./src/routes/products');
const routesRouter = require('./src/routes/routes');
const authRouter = require('./src/routes/auth');
const usersRouter = require('./src/routes/users');
const meRouter = require('./src/routes/me');
const routeAssetsRouter = require('./src/routes/routeAssets');
const socialRouter = require('./src/routes/social');
const postsRouter = require('./src/routes/posts');
const integrationRoutes = require('./src/routes/integrationRoutes');
const parksRouter = require('./src/routes/parks');
// 限流已改為空 middleware（見 src/middleware/rateLimiter.js），測試期不會 429
const { authRateLimiter, integrationRateLimiter } = require('./src/middleware/rateLimiter');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const PORT_MAX_TRY = 5;
const LISTEN_HOST = '0.0.0.0';

/**
 * 將 URL 中路徑連續斜線合併為單一斜線，避免 api//auth 類拼寫導致路由異常。
 */
function dedupeUrlSlashes(req) {
  const fix = (u) => {
    if (!u || typeof u !== 'string') return u;
    const q = u.indexOf('?');
    const pathPart = q >= 0 ? u.slice(0, q) : u;
    const query = q >= 0 ? u.slice(q) : '';
    // 合併路徑中多餘斜線（含 api//auth）
    let normalized = pathPart.replace(/\/+/g, '/');
    if (!normalized.startsWith('/')) normalized = `/${normalized}`;
    return (normalized || '/') + query;
  };
  req.url = fix(req.url);
  if (req.originalUrl) req.originalUrl = fix(req.originalUrl);
}

/**
 * 取得本機非內部 IPv4 位址（熱點 / Wi‑Fi / 區網），供真機連線。
 */
function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal) {
        out.push({ ifName: name, address: net.address });
      }
    }
  }
  return out;
}

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Access-Token'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);
app.use(express.json());
app.use((req, res, next) => {
  dedupeUrlSlashes(req);
  next();
});
/**
 * 測試期全量日誌：僅 console.log 到終端，絕不寫入 res / response body。
 * （上線前請關閉或改為採樣）
 */
app.use((req, res, next) => {
  const url = req.originalUrl || req.url;
  console.log('\n========== 收到請求 ==========');
  console.log(req.method, url);
  console.log('[headers]', JSON.stringify(req.headers, null, 2));
  console.log('[body]', req.body === undefined ? '(未解析或無 body)' : JSON.stringify(req.body, null, 2));
  console.log('==============================\n');
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'hikbik-server' });
});

// 上傳頭像等靜態檔（avatarUrl 如 /uploads/xxx.jpg）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/**
 * 認證路由必須最先掛載，且勿使用 app.use(verifyJWT) 全域攔截。
 * login / register / send-otp 等皆不帶 JWT；僅 auth 內個別路由（如 PATCH /profile）掛 verifyJWT。
 */
app.use('/api/auth', authRateLimiter, authRouter);

app.use('/api', productsRouter);
app.use('/api', parksRouter);
app.use('/api', routesRouter);
app.use('/api/users', usersRouter);
/** 與 /api/users 相同路由，兼容前端單數路徑 /api/user/* */
app.use('/api/user', usersRouter);
app.use('/api/me', require('./src/middleware/authMiddleware').verifyJWT, meRouter);
app.use('/api/routes', routeAssetsRouter);
app.use('/api/social', socialRouter);
app.use('/api/posts', postsRouter);
app.use('/api/integration', integrationRateLimiter, integrationRoutes);

/** 測試資料 seed / purge：設 ENABLE_TEST_PURGE=true；用完請關閉並刪除此段 */
if (process.env.ENABLE_TEST_PURGE === 'true') {
  const { purgeDummies } = require('./src/controllers/testPurgeController');
  const { seedDummies } = require('./src/controllers/testSeedController');
  app.post('/api/test/seed-dummies', seedDummies);
  app.delete('/api/test/purge-dummies', purgeDummies);
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message || '伺服器錯誤',
    message: err.message || '伺服器錯誤',
  });
});

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, LISTEN_HOST, () => resolve(server));
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') reject(err);
      else reject(err);
    });
  });
}

async function start() {
  const jwtSecretSet = Boolean(String(process.env.JWT_SECRET || '').trim());
  if ((process.env.NODE_ENV === 'production' || process.env.RENDER) && !jwtSecretSet) {
    console.error(
      '[auth] ⚠ JWT_SECRET 未設定：請在 Render（或主機）Environment 設定「固定」密鑰；否則重啟後簽章變了，既有 Bearer Token 會變成 invalid signature。'
    );
  }

  if (process.env.MONGODB_URI) {
    try {
      await connectDB();
    } catch (err) {
      console.error('啟動時無法連線 MongoDB，驗證登入與用戶資料接口將不可用');
    }
  }

  let port = DEFAULT_PORT;
  for (let i = 0; i < PORT_MAX_TRY; i++) {
    try {
      const server = await tryListen(port);
      console.log(`Server 正在監聽所有網路介面，端口：${port}`);
      const lanAddrs = getLanIPv4Addresses();
      if (lanAddrs.length === 0) {
        console.warn('未偵測到區網 IPv4（請檢查 Wi‑Fi / 熱點是否已開啟）');
      } else {
        for (const { ifName, address } of lanAddrs) {
          console.log(`  區網介面 ${ifName}: ${address} → http://${address}:${port}`);
        }
        const primary = lanAddrs[0].address;
        console.log(`Server is live at http://${primary}:${port}`);
      }
      console.log(`HIKBIK Server 運行於 http://localhost:${port}（本機）`);
      console.log(`  - GET  /api/inventory  站點庫存（全球資產）`);
      console.log(`  - GET  /api/parks  美國國家公園（NPS 代理，最多 100 筆，需 NPS_API_KEY）`);
      console.log(`  - POST /api/test-path  路徑引擎（GPS）`);
      console.log(`  - /api/auth  登錄、send-otp、verify-otp、GET|PATCH /api/auth/me`);
      console.log(`  - GET  /api/routes/feed  Feed 列表`);
      console.log(`  - POST /api/routes/upload、/api/routes/publish  上傳/發佈路線（需 JWT）`);
      console.log(`  - GET  /api/users/:id/profile  用戶社交檔案（可選 JWT → isFollowing）`);
      console.log(`  - GET  /api/users/:id/following  關注列表（populate nickname / avatarUrl）`);
      console.log(`  - GET/PATCH /api/users/me、PATCH /api/users/profile、POST /api/users/avatar、POST /api/users/:id/follow  用戶資料/頭像/關注`);
      console.log(`  - GET  /api/user/saved-parks（同 /api/users/saved-parks，需 JWT）收藏國家公園列表`);
      console.log(`  - PATCH /api/auth/profile  更新頭像 URL 等（同 updateProfile，需 JWT）`);
      console.log(`  - GET  /uploads/...  上傳檔靜態服務`);
      console.log(`  - GET  /api/social/feed  社群廣場（可選 JWT → isLiked）`);
      console.log(`  - GET  /api/social/me/posts  我的貼文（需 JWT）`);
      console.log(`  - GET  /api/social/me/liked-posts  已讚貼文（需 JWT）`);
      console.log(`  - POST /api/social/:id/like、/:id/comment、/:id/comment/:commentId/like  讚/評論/評論讚（需 JWT）`);
      console.log(`  - POST /api/social/publish、toggle-like、toggle-follow、follow/:userId、upload-image（需 JWT）`);
      console.log(`  - GET/POST/PATCH/DELETE /api/routes/:id/reviews  評論 CRUD`);
      console.log(`  - /api/integration/travel, /shop, /tools  插件化服務（Mock 待對接）`);
      if (process.env.ENABLE_TEST_PURGE === 'true') {
        console.warn(
          '  ⚠ POST /api/test/seed-dummies、DELETE /api/test/purge-dummies  測試後門已開啟（ENABLE_TEST_PURGE）；用完請關閉並從 server.js 移除'
        );
      }
      return;
    } catch (err) {
      if (err.code === 'EADDRINUSE' && i < PORT_MAX_TRY - 1) {
        console.warn(`埠 ${port} 已被佔用，嘗試 ${port + 1}...`);
        port += 1;
      } else {
        console.error('伺服器啟動失敗:', err.message);
        process.exit(1);
      }
    }
  }
}

start();
