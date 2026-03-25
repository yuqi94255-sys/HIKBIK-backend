/**
 * Cloudinary 上傳（僅讀環境變數，金鑰不寫死在代碼）
 * 支援 CLOUDINARY_URL 或 CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 */
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const FOLDER = 'hikbik_uploads';

function configureCloudinary() {
  const url = process.env.CLOUDINARY_URL;
  if (url) {
    cloudinary.config({ url });
    return true;
  }
  const name = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (name && key && secret) {
    cloudinary.config({
      cloud_name: name,
      api_key: key,
      api_secret: secret,
    });
    return true;
  }
  return false;
}

let multerInstance = null;

function getUploadCloud() {
  if (multerInstance) return multerInstance;
  if (!configureCloudinary()) {
    throw new Error(
      'Cloudinary 未配置：請設定 CLOUDINARY_URL 或 CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET'
    );
  }

  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: FOLDER,
      allowed_formats: ['jpg', 'png', 'jpeg'],
      /** 自動縮圖：最長邊限制在 1200px 內（不裁切，等比縮小） */
      transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
      public_id: (req, file) => {
        const base = (file.originalname || 'image').replace(/\.[^.]+$/, '');
        const safe = String(base).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
        return `hb_${Date.now()}_${safe}`;
      },
    },
  });

  multerInstance = multer({
    storage,
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /^(image\/(jpeg|jpg|png))$/i.test(file.mimetype || '');
      if (!ok) {
        return cb(new Error('僅允許上傳 jpg、jpeg、png'));
      }
      cb(null, true);
    },
  });

  return multerInstance;
}

/**
 * 與 multer 相同 API：uploadCloud.single('file')
 * 內建 Cloudinary 未配置 / Multer 錯誤時回 400 JSON
 */
const uploadCloud = {
  single(fieldName) {
    return (req, res, next) => {
      let parser;
      try {
        parser = getUploadCloud();
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: e.message || 'Cloudinary 配置錯誤',
        });
      }
      parser.single(fieldName)(req, res, (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            message: err.message || '上傳失敗',
          });
        }
        next();
      });
    };
  },
};

module.exports = { uploadCloud, cloudinary, getUploadCloud, FOLDER };
