#!/usr/bin/env node
/**
 * 一次性維護：刪除 routes 集合全部文件，並清空所有用戶的 likedRoutes。
 * 極度危險，僅在確認要抹掉 Render／本機庫內所有路線資料時執行。
 *
 * 勿掛在 server.js 每次啟動（會每次部署都清空）。請在 Render Shell 或本機對準目標 URI 手動跑一次：
 *   node scripts/purgeRoutesAndUserLikes.js
 *
 * 注意：User.publishedTracks 等欄位若曾指向 Route，刪除後會變成孤兒引用，需另行遷移或手動清理。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Route = require('../src/models/Route');
const User = require('../src/models/User');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('錯誤：請在 .env 設定 MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const routeResult = await Route.deleteMany({});
  const userResult = await User.updateMany({}, { $set: { likedRoutes: [] } });

  console.log('Route.deleteMany({}):', {
    deletedCount: routeResult.deletedCount,
  });
  console.log('User.updateMany likedRoutes -> []:', {
    matchedCount: userResult.matchedCount,
    modifiedCount: userResult.modifiedCount,
  });
  console.log('路線與用戶點讚列表清理完成');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
