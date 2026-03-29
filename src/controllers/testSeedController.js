const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const { buildSummaryForPublish } = require('../utils/socialPublishSummary');

const SEED_SPECS = [
  {
    nickname: 'Yosemite_Master',
    bio: '專業登山教練，帶你征服半圓頂',
    email: 'seed.yosemite_master@hikbik.test',
    renderData: {
      journeyName: '優勝美地 · 半圓頂日出脊線',
      totalDistance: 28.5,
      vehicle: 'Hike',
      days: { count: 2 },
      dayPhotos: [
        'https://images.unsplash.com/photo-1562310503-efbfa955c4d3?w=1200',
        'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200',
      ],
      descriptions: '從 Happy Isles 出發，經 Mist Trail 與 Nevada Fall，加州高海拔花崗岩與松林交錯。',
    },
  },
  {
    nickname: 'California_Hiker',
    bio: '走遍加州所有 Trail',
    email: 'seed.california_hiker@hikbik.test',
    renderData: {
      journeyName: 'Big Sur 海岸 · 紫暮與霧',
      totalDistance: 42,
      vehicle: 'Hike',
      days: { count: 3 },
      images: [
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200',
      ],
      descriptions: '沿 1 號公路南下，太平洋霧帶與紅杉林，典型加州海岸戶外風景。',
    },
  },
  {
    nickname: 'BayArea_Cyclist',
    bio: '舊金山灣區騎行愛好者',
    email: 'seed.bayarea_cyclist@hikbik.test',
    renderData: {
      journeyName: '灣區 · 金門大橋到索薩利托',
      totalDistance: 35.2,
      vehicle: 'Bike',
      days: { count: 1 },
      dayPhotos: [
        'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200',
      ],
      descriptions: '海風、丘陵與自行車道，舊金山灣區經典一日戶外路線。',
    },
  },
];

const NICKNAMES = SEED_SPECS.map((s) => s.nickname);

/**
 * POST /api/test/seed-dummies
 * 僅在 ENABLE_TEST_PURGE=true 時由 server.js 掛載。
 */
async function seedDummies(req, res) {
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

    const existing = await User.find({
      nickname: { $in: NICKNAMES },
      isTestUser: true,
    })
      .select('_id nickname')
      .lean();

    if (existing.length === 3) {
      const userIds = existing.map((u) => u._id);
      const posts = await Post.find({ author: { $in: userIds } })
        .select('_id author')
        .sort({ createdAt: 1 })
        .lean();

      console.log('[seed-dummies] 測試帳號已存在，略過創建（idempotent）');
      return res.json({
        success: true,
        alreadySeeded: true,
        users: existing.map((u) => ({ id: u._id.toString(), nickname: u.nickname })),
        posts: posts.map((p) => ({
          id: p._id.toString(),
          authorId: p.author.toString(),
        })),
      });
    }

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          '偵測到部分測試帳號（isTestUser），請先執行 DELETE /api/test/purge-dummies 再重新 seed',
        partialUserIds: existing.map((u) => u._id.toString()),
      });
    }

    const createdUsers = [];
    const createdPosts = [];

    for (const spec of SEED_SPECS) {
      const user = await User.create({
        email: spec.email,
        nickname: spec.nickname,
        bio: spec.bio,
        isTestUser: true,
        password: null,
        firstName: '',
        lastName: '',
      });

      const renderData = spec.renderData;
      const postId = new mongoose.Types.ObjectId();
      const plain = buildSummaryForPublish('COMMUNITY_MACRO', renderData, {
        postId: postId.toString(),
        authorId: user._id.toString(),
        authorName: user.nickname,
        authorAvatarUrl: '',
        authorSubtitle: user.bio || '',
      });

      const coverImageUrl = plain.coverImageUrl ?? '';
      const imageUrls = Array.isArray(plain.imageUrls) ? [...plain.imageUrls] : [];

      await Post.create({
        _id: postId,
        author: user._id,
        postCategory: 'COMMUNITY_MACRO',
        coverImageUrl,
        imageUrls,
        renderData,
        summary: {
          ...plain,
          authorId: user._id,
        },
        likedBy: [],
        comments: [],
        likeCount: 0,
        commentCount: 0,
      });

      createdUsers.push({ id: user._id.toString(), nickname: user.nickname });
      createdPosts.push({ id: postId.toString(), authorId: user._id.toString() });
    }

    console.log('[seed-dummies] 測試帳號創建成功');
    return res.status(201).json({
      success: true,
      alreadySeeded: false,
      users: createdUsers,
      posts: createdPosts,
    });
  } catch (err) {
    console.error('[seed-dummies] 錯誤:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'seed 失敗',
    });
  }
}

module.exports = { seedDummies, SEED_SPECS, NICKNAMES };
