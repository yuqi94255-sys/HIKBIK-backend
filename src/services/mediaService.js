const cloudinary = require('cloudinary').v2;
const { keysToSnakeCase } = require('../utils/snakeCase');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CLOUDINARY_URL = process.env.CLOUDINARY_URL;

const FOLDER = 'hikbik_uploads';

function isConfigured() {
  if (CLOUDINARY_URL) return true;
  return !!(CLOUD_NAME && API_KEY && API_SECRET);
}

function ensureConfig() {
  if (CLOUDINARY_URL) {
    cloudinary.config({ url: CLOUDINARY_URL });
    return;
  }
  if (CLOUD_NAME && API_KEY && API_SECRET) {
    cloudinary.config({
      cloud_name: CLOUD_NAME,
      api_key: API_KEY,
      api_secret: API_SECRET,
    });
    return;
  }
  throw new Error('請設定 CLOUDINARY_URL 或 CLOUDINARY_CLOUD_NAME + API_KEY + API_SECRET');
}

/**
 * 將前端傳來的圖片（Buffer 或 Base64）轉成 Cloudinary 可接受的格式
 * - Buffer -> data URI
 * - Base64 字串 -> 若無 data URI 前綴則補上
 */
function toDataUri(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) {
    return `data:image/png;base64,${input.toString('base64')}`;
  }
  if (typeof input === 'string') {
    if (input.startsWith('data:')) return input;
    return `data:image/png;base64,${input}`;
  }
  return null;
}

/**
 * 上傳圖片至 Cloudinary 的 hikbik_uploads 文件夾
 * @param {Buffer|string} fileOrBuffer - 圖片 Buffer 或 Base64 字串
 * @param {object} options - 可選 { folder, public_id }
 * @returns {Promise<{ success: true, url: string, public_id: string }>}
 */
async function uploadImage(fileOrBuffer, options = {}) {
  if (!isConfigured()) {
    return keysToSnakeCase({
      status: 'ready_for_api_key',
      message: '請設定 CLOUDINARY_URL 或 CLOUDINARY_CLOUD_NAME + API_KEY + API_SECRET',
      url: null,
      public_id: null,
    });
  }

  try {
    ensureConfig();
    const dataUri = toDataUri(fileOrBuffer);
    if (!dataUri) {
      throw new Error('請提供圖片 Buffer 或 Base64 字串');
    }

    const folder = options.folder ?? FOLDER;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: 'image',
      ...options,
    });

    return keysToSnakeCase({
      success: true,
      secure_url: result.secure_url,
      public_id: result.public_id,
      format: result.format || null,
      width: result.width,
      height: result.height,
      created_at: result.created_at,
    });
  } catch (err) {
    const message = err.message || '上傳失敗';
    const status = err.http_code || (err.error ? 400 : 503);
    throw Object.assign(new Error(message), { status });
  }
}

module.exports = {
  uploadImage,
  isConfigured,
};
