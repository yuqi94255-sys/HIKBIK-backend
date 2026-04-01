const mongoose = require('mongoose');

/**
 * 以 park_code（小寫）覆寫 GET /api/parks 的 cover_image（NPS 缺圖或前端自訂代碼時使用）
 */
const parkCoverOverrideSchema = new mongoose.Schema(
  {
    park_code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 16,
    },
    cover_image: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ParkCoverOverride', parkCoverOverrideSchema);
