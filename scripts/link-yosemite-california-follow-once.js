#!/usr/bin/env node
/**
 * 單次臨時腳本：讓 Yosemite_Master、California_Hiker 的 following 加入「你」，
 * 並在你的 followers 加入他們兩人，並依陣列長度校準計數。
 *
 * 執行（專案根目錄）：
 *   LINK_TEST_MY_USER_ID=<你的MongoDB_ObjectId> node scripts/link-yosemite-california-follow-once.js
 *
 * 跑完請刪除此檔案並勿提交敏感 ID 到版本紀錄。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const NICKNAMES = ['Yosemite_Master', 'California_Hiker'];

function syncUserCounts(userId) {
  return User.findById(userId).select('followers following').lean().then((doc) => {
    if (!doc) return;
    return User.updateOne(
      { _id: userId },
      {
        $set: {
          followersCount: (doc.followers || []).length,
          followingCount: (doc.following || []).length,
        },
      }
    );
  });
}

async function main() {
  const myIdRaw = process.env.LINK_TEST_MY_USER_ID;
  if (!myIdRaw || !mongoose.Types.ObjectId.isValid(myIdRaw)) {
    console.error('請設定環境變數 LINK_TEST_MY_USER_ID 為你的 User ObjectId（24 位 hex）');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('請設定 MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const myOid = new mongoose.Types.ObjectId(myIdRaw);

  const me = await User.findById(myOid).select('_id nickname');
  if (!me) {
    console.error('找不到 LINK_TEST_MY_USER_ID 對應用戶');
    await mongoose.disconnect();
    process.exit(1);
  }

  const them = await User.find({ nickname: { $in: NICKNAMES } }).select('_id nickname');
  if (them.length < 2) {
    console.warn(
      '預期找到 2 位用戶，實際:',
      them.length,
      them.map((t) => ({ id: String(t._id), nickname: t.nickname }))
    );
  }

  for (const u of them) {
    await User.updateOne({ _id: u._id }, { $addToSet: { following: myOid } });
  }
  for (const u of them) {
    await User.updateOne({ _id: myOid }, { $addToSet: { followers: u._id } });
  }

  await syncUserCounts(myOid);
  for (const u of them) {
    await syncUserCounts(u._id);
  }

  const meAfter = await User.findById(myOid).select('followers following followersCount').lean();
  console.log('[link-follow-once] 完成');
  console.log('  你的 id:', String(myOid));
  console.log('  你的 followersCount:', meAfter.followersCount, 'followers.length:', (meAfter.followers || []).length);
  console.log(
    '  已連結:',
    them.map((t) => `${t.nickname} (${t._id})`)
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
