const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/** 與全專案 bcryptjs 一致（register、腳本、登入比對皆用此輪數） */
const BCRYPT_SALT_ROUNDS = 10;

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    nickname: {
      type: String,
      default: 'Explorer',
      trim: true,
    },
    firstName: {
      type: String,
      default: '',
      trim: true,
    },
    lastName: {
      type: String,
      default: '',
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: '',
    },
    followingCount: {
      type: Number,
      default: 0,
    },
    followersCount: {
      type: Number,
      default: 0,
    },
    totalDistanceMeters: {
      type: Number,
      default: 0,
    },
    // Email + password 登錄（需用 bcrypt 加密後存）
    password: {
      type: String,
      default: null,
    },
    /** 測試／種子虛擬帳號標記；清理時可 deleteMany({ isTestUser: true }) */
    isTestUser: {
      type: Boolean,
      default: false,
    },
    is_verified: {
      type: Boolean,
      default: false,
    },
    // 6 位數 Email 驗證碼（Resend）
    verification_code: {
      type: String,
      default: null,
    },
    verification_code_expires: {
      type: Date,
      default: null,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpires: {
      type: Date,
      default: null,
    },
    publishedTracks: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
    ],
    likedRoutes: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
    ],
    /** 當前用戶關注的 User _id（與 followingCount 同步維護） */
    following: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ],
    /** 關注當前用戶的 User _id（與 followersCount 同步維護）；判斷 isFollowing 時查「對方是否在本人 followers」即：本人 id 是否在對方此陣列 */
    followers: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ],
    savedDestinations: [
      {
        name: { type: String, default: '' },
        category: { type: String, default: '' },
        agency: { type: String, default: '' },
        imageUrl: { type: String, default: '' },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        dateSaved: { type: Date, default: Date.now },
      },
    ],
    /** 國家公園收藏（對齊 GET /api/user/saved-parks） */
    savedParks: [
      {
        parkCode: { type: String, required: true, trim: true },
        fullName: { type: String, default: '' },
        coverImage: { type: String, default: '' },
        description: { type: String, default: '' },
        dateSaved: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

/**
 * 新建或修改 password 時自動 bcrypt 雜湊（僅 bcryptjs，與控制器一致）
 * - 明文：寫入前 hash
 * - 已是 $2a$/$2b$/$2y$ 格式：不重複 hash（相容舊資料與腳本直接寫入的 hash）
 * - null / 空字串：保持 null（OAuth、僅 OTP 用戶可無密碼）
 */
userSchema.pre('save', async function hashPasswordPreSave(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const pwd = this.password;
  if (pwd == null || pwd === '') {
    this.password = null;
    return next();
  }
  if (typeof pwd !== 'string') {
    return next(new Error('password 必須為字串'));
  }
  if (isBcryptHash(pwd)) {
    return next();
  }
  try {
    this.password = await bcrypt.hash(pwd, BCRYPT_SALT_ROUNDS);
    return next();
  } catch (err) {
    return next(err);
  }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
User.BCRYPT_SALT_ROUNDS = BCRYPT_SALT_ROUNDS;
module.exports = User;
