const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

/**
 * 社群貼文（SocialPost / Post）
 * - 頂層 coverImageUrl、imageUrls：與前端發佈 body 對齊
 * - renderData：Mixed，等同前端 payload（Macro/Micro）
 * - summary：列表快取；likeCount / commentCount 與頂層冗餘同步
 * - likedBy / comments：互動資料，與當前 User 綁定
 */
const summarySchema = new mongoose.Schema(
  {
    id: { type: String, default: '' },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorName: { type: String, default: '' },
    authorAvatarUrl: { type: String, default: '' },
    authorSubtitle: { type: String, default: '' },
    title: { type: String, default: '' },
    coverImageUrl: { type: String, default: '' },
    imageUrls: { type: [String], default: [] },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    /** COMMUNITY_MACRO */
    days: { type: mongoose.Schema.Types.Mixed, default: null },
    mileage: { type: String, default: '' },
    vehicle: { type: String, default: '' },
    /** COMMUNITY_MICRO */
    distance: { type: String, default: '' },
    elevationGain: { type: mongoose.Schema.Types.Mixed, default: null },
    durationDisplay: { type: String, default: '' },
    activityType: { type: String, default: '' },
    trackTier: { type: String, default: '' },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    postCategory: {
      type: String,
      required: true,
      enum: ['COMMUNITY_MACRO', 'COMMUNITY_MICRO'],
    },
    coverImageUrl: {
      type: String,
      default: '',
    },
    imageUrls: {
      type: [{ type: String }],
      default: [],
    },
    /** 前端完整 payload（Macro/Micro） */
    renderData: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    summary: {
      type: summarySchema,
      required: true,
    },
    likedBy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    comments: {
      type: [commentSchema],
      default: [],
    },
    /** 冗餘計數（與 summary.likeCount / summary.commentCount 同步更新） */
    likeCount: {
      type: Number,
      default: 0,
    },
    commentCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ postCategory: 1, createdAt: -1 });
postSchema.index({ likedBy: 1 });

const Post = mongoose.models.Post || mongoose.model('Post', postSchema);
module.exports = Post;
