const mongoose = require('mongoose');

/**
 * TripPlan — 使用者自己的行程計劃（跨裝置持久化）。
 *
 * 兩種來源嚴格分開（見產品需求「DIY 計劃跟 AI 計劃要分開，不管後端還是 UI」）：
 *   - origin: 'ai'  → AI 生成的計劃（read-only artifact，對話式局部修改）
 *   - origin: 'diy' → 使用者自建（Build Your Own）
 *
 * 兩種狀態：
 *   - status: 'draft' → 草稿（還在編、未定稿）
 *   - status: 'saved' → 已存（定稿）
 *
 * `plan` 存整個 iOS `CustomRoute` 的 JSON（含 days / stops / segments / context…），
 * 用 Mixed 避免逐欄位重建那套很深的巢狀結構；列表用的關鍵欄位另外 mirror 出來供查詢/排序。
 *
 * `clientId` = App 端 CustomRoute.id（UUID 字串），供跨裝置 upsert / 去重：
 * 同一 user + 同一 clientId 視為同一份計劃。
 */
const tripPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientId: {
      type: String,
      required: true,
      trim: true,
    },
    origin: {
      type: String,
      enum: ['ai', 'diy'],
      required: true,
      default: 'diy',
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'saved'],
      required: true,
      default: 'saved',
      index: true,
    },

    // 列表 / 卡片用的 mirror 欄位（避免每次都要拆 plan）
    name: { type: String, default: 'Untitled Route', trim: true },
    description: { type: String, default: '' },
    coverImageURL: { type: String, default: '' },
    citySlug: { type: String, default: '' },
    defaultMode: { type: String, default: 'walking' },
    notes: { type: String, default: '' },

    // 完整 CustomRoute JSON（days / stops / segments / context…）
    plan: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
  },
  { timestamps: true }
);

// 跨裝置 upsert 的唯一鍵：同 user + 同 clientId 只有一份
tripPlanSchema.index({ userId: 1, clientId: 1 }, { unique: true });
// 列表常用查詢
tripPlanSchema.index({ userId: 1, origin: 1, status: 1, updatedAt: -1 });

const TripPlan =
  mongoose.models.TripPlan || mongoose.model('TripPlan', tripPlanSchema);

module.exports = TripPlan;
