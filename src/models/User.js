const mongoose = require('mongoose');

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
    following: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ],
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
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);
module.exports = User;
