#!/usr/bin/env node
/**
 * 暴力重置指定用戶密碼：使用 MongoDB 原生 collection.updateOne，繞過 Mongoose pre-save，
 * 避免密碼被鉤子二次 bcrypt。雜湊與後端一致：bcryptjs、salt rounds = 10。
 *
 * 用法（專案根目錄，需 .env 內 MONGODB_URI）：
 *   RESET_PASSWORD='你的新密碼' node fix-user.js
 *   RESET_EMAIL=other@mail.com RESET_PASSWORD='...' node fix-user.js
 * 或：
 *   node fix-user.js '你的新密碼'
 *
 * 勿將明文密碼寫入本檔或提交至 Git。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI;
const email = (process.env.RESET_EMAIL || 'yuqi94255@gmail.com').toLowerCase().trim();
const rawPassword = process.env.RESET_PASSWORD || process.argv[2];

const BCRYPT_ROUNDS = 10;

async function runFix() {
  if (!MONGODB_URI) {
    console.error('錯誤：請在 .env 設定 MONGODB_URI（或匯出環境變數）');
    process.exit(1);
  }
  if (!rawPassword) {
    console.error('錯誤：請提供新密碼，例如：RESET_PASSWORD=\'...\' node fix-user.js');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已連接至資料庫...');

    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const newHash = await bcrypt.hash(rawPassword, salt);

    const result = await mongoose.connection.db.collection('users').updateOne(
      { email },
      { $set: { password: newHash } }
    );

    if (result.matchedCount > 0) {
      console.log(`成功定位用戶: ${email}`);
      console.log('密碼已寫入新 bcrypt hash（明文請自行保管，勿重複貼到日誌）');
      console.log(`新 Hash 前綴: ${newHash.substring(0, 10)}...`);
      if (result.modifiedCount === 0) {
        console.log('（matched 但 modified 為 0：可能 hash 與先前相同）');
      }
    } else {
      console.log('找不到該 Email，請檢查資料庫拼寫或小寫是否一致。');
    }
  } catch (err) {
    console.error('執行失敗:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
    process.exit();
  }
}

runFix();
