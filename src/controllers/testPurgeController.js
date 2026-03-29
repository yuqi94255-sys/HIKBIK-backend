const User = require('../models/User');
const Post = require('../models/Post');

const DUMMY_NICKNAMES = ['Yosemite_Master', 'California_Hiker', 'BayArea_Cyclist'];

/**
 * DELETE /api/test/purge-dummies
 * 僅在 ENABLE_TEST_PURGE=true 時由 server.js 掛載；用完請關閉並刪除此路由。
 *
 * 1) 目標用戶：nickname 命中三個測試暱稱，或 isTestUser: true
 * 2) 刪除這些 author 的社群 Post（Community 貼文）
 * 3) 全庫 $pull 上述 _id 出 following/followers，並將 followingCount、followersCount 與陣列長度對齊
 * 4) 刪除目標用戶
 */
async function purgeDummies(req, res) {
  if (process.env.ENABLE_TEST_PURGE !== 'true') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  try {
    if (!process.env.MONGODB_URI) {
      return res.status(503).json({
        success: false,
        message: 'MONGODB_URI 未設定',
      });
    }

    const targets = await User.find({
      $or: [{ nickname: { $in: DUMMY_NICKNAMES } }, { isTestUser: true }],
    })
      .select('_id nickname isTestUser')
      .lean();

    const targetIds = targets.map((t) => t._id);
    if (targetIds.length === 0) {
      console.log('[purge-dummies] 無符合條件的測試用戶，略過');
      return res.json({
        success: true,
        message: '無符合條件的測試用戶',
        deletedUserIds: [],
        deletedPosts: 0,
        recalibratedUsers: 0,
      });
    }

    console.log(
      '[purge-dummies] 將刪除用戶:',
      targets.map((t) => ({ id: String(t._id), nickname: t.nickname, isTestUser: t.isTestUser }))
    );

    const postResult = await Post.deleteMany({ author: { $in: targetIds } });

    await User.updateMany(
      {},
      {
        $pull: {
          following: { $in: targetIds },
          followers: { $in: targetIds },
        },
      }
    );

    let recalibratedUsers = 0;
    const cursor = User.find({}).select('_id following followers').cursor();
    for await (const u of cursor) {
      const fc = (u.following || []).length;
      const fwc = (u.followers || []).length;
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            followingCount: fc,
            followersCount: fwc,
          },
        }
      );
      recalibratedUsers += 1;
    }

    const userResult = await User.deleteMany({ _id: { $in: targetIds } });

    console.log(
      '[purge-dummies] 完成 deletedUsers=%d deletedPosts=%d recalibratedUsers=%d',
      userResult.deletedCount,
      postResult.deletedCount,
      recalibratedUsers
    );

    return res.json({
      success: true,
      deletedUserIds: targetIds.map((id) => id.toString()),
      deletedUsers: userResult.deletedCount,
      deletedPosts: postResult.deletedCount,
      recalibratedUsers,
    });
  } catch (err) {
    console.error('[purge-dummies] 錯誤:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'purge 失敗',
    });
  }
}

module.exports = { purgeDummies, DUMMY_NICKNAMES };
