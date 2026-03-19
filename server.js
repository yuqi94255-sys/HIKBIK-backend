// 必須最先執行：確保 .env 在所有數據庫/配置調用之前載入
require('dotenv').config();

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
const { authRateLimiter, integrationRateLimiter } = require('./src/middleware/rateLimiter');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const PORT_MAX_TRY = 5;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'hikbik-server' });
});

app.use('/api', productsRouter);
app.use('/api', routesRouter);
app.use('/api/auth', authRateLimiter, authRouter);
app.use('/api/users', usersRouter);
app.use('/api/me', require('./src/middleware/authMiddleware').verifyJWT, meRouter);
app.use('/api/routes', routeAssetsRouter);
app.use('/api/social', socialRouter);
app.use('/api/posts', postsRouter);
app.use('/api/integration', integrationRateLimiter, integrationRoutes);

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
    const server = app.listen(port, () => resolve(server));
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') reject(err);
      else reject(err);
    });
  });
}

async function start() {
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
      console.log(`HIKBIK Server 運行於 http://localhost:${port}`);
      console.log(`  - GET  /api/inventory  站點庫存（全球資產）`);
      console.log(`  - POST /api/test-path  路徑引擎（GPS）`);
      console.log(`  - /api/auth  登錄、send-otp、verify-otp`);
      console.log(`  - GET  /api/routes/feed  Feed 列表`);
      console.log(`  - POST /api/routes/upload、/api/routes/publish  上傳/發佈路線（需 JWT）`);
      console.log(`  - GET /api/users/me  當前用戶資料（需 JWT）`);
      console.log(`  - POST /api/social/toggle-like、toggle-follow（需 JWT）`);
      console.log(`  - GET/POST/PATCH/DELETE /api/routes/:id/reviews  評論 CRUD`);
      console.log(`  - /api/integration/travel, /shop, /tools  插件化服務（Mock 待對接）`);
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
