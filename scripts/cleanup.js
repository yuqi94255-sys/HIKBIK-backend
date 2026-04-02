#!/usr/bin/env node
/**
 * 臨時維護：清空 posts 集合內所有文件的 likedBy，並將 likeCount 設為 0。
 * 危險操作，執行前請確認已備份或僅用於測試庫。
 *
 * 用法（專案根目錄）：
 *   node scripts/cleanup.js
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
  const col = mongoose.connection.db.collection('posts');

  const result = await col.updateMany(
    {},
    { $set: { likedBy: [], likeCount: 0 } }
  );

  console.log('updateMany:', {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  });
  console.log('數據清理完成');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
