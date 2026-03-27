const mongoose = require('mongoose');

/**
 * 社群貼文（SocialPost / Post）
 * - 頂層 coverImageUrl、imageUrls：與前端發佈 body 對齊，避免 strict schema 丟欄位
 * - renderData：Mixed，等同前端 payload（Macro/Micro 任意結構）
 * - summary：列表快取（鍵名與 GrandJourneyItem / DetailedTrackItem 對齊）
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
  },
  { timestamps: true }
);

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ postCategory: 1, createdAt: -1 });

const Post = mongoose.models.Post || mongoose.model('Post', postSchema);
module.exports = Post;
