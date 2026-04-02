#!/usr/bin/env node
/**
 * 臨時維護：清空所有 users 的 likedRoutes 陣列。
 * 用法（專案根目錄）：node scripts/clearUserLikedRoutes.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('錯誤：請在 .env 設定 MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await mongoose.connection.db
    .collection('users')
    .updateMany({}, { $set: { likedRoutes: [] } });
  console.log('matched:', result.matchedCount, 'modified:', result.modifiedCount);
  console.log('User 點讚已清空');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
