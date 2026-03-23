#!/usr/bin/env node
/**
 * 一次性修復：為指定 email 用戶寫入 bcrypt 密碼（與 authController register 相同：bcryptjs + saltRounds=10）
 *
 * 用法（專案根目錄）：
 *   node scripts/fix-user-password-once.js "你的新密碼"
 *
 * 可選環境變數：
 *   TARGET_EMAIL=xxx@xxx.com   （預設 yuqi94255@gmail.com）
 *
 * 執行完請在 MongoDB Compass/Atlas 確認 password 為 $2a$... 雜湊，然後可刪除此腳本。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../src/models/User');

const SALT_ROUNDS = User.BCRYPT_SALT_ROUNDS || 10;
const EMAIL = (process.env.TARGET_EMAIL || 'yuqi94255@gmail.com').toLowerCase().trim();
const plainPassword = process.argv[2] || process.env.NEW_PASSWORD;

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('錯誤：請在 .env 設定 MONGODB_URI');
    process.exit(1);
  }
  if (!plainPassword) {
    console.error('錯誤：請傳入新密碼（不可寫死在程式裡）：');
    console.error('  node scripts/fix-user-password-once.js "<新密碼>"');
    console.error('或: NEW_PASSWORD=xxx node scripts/fix-user-password-once.js');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);

  const updated = await User.findOneAndUpdate(
    { email: EMAIL },
    { $set: { password: hash } },
    { new: true }
  );

  if (!updated) {
    console.error('找不到 email 為下列的用戶:', EMAIL);
    await mongoose.disconnect();
    process.exit(1);
  }

  const p = updated.password;
  console.log('--- 更新成功 ---');
  console.log('email:', updated.email);
  console.log('password 已寫入 bcrypt 雜湊（非明文）');
  console.log('雜湊長度:', p ? p.length : 0);
  console.log('雜湊前綴（應為 $2a$ / $2b$）:', p ? p.slice(0, 7) : '(null)');
  console.log('請到 MongoDB 介面確認 password 欄位為一長串雜湊，不是 null。');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
