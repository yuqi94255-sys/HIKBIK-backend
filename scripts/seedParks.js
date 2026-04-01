#!/usr/bin/env node
/**
 * 將指定 park_code 的官方 NPS 封面 URL 寫入 MongoDB（ParkCoverOverride），
 * 供 GET /api/parks 覆寫 NPS 缺圖或錯誤來源；執行後會清除伺服器端 NPS 列表快取鍵。
 *
 * 用法（專案根目錄）：
 *   node scripts/seedParks.js
 *
 * 需 .env 內 MONGODB_URI。
 *
 * 資料來源說明：
 * - seki / yose / hosp / jeff：NPS Data API v1 /parks?parkCode=…&fields=images 之 images[0].url
 * - sequ：NPS 無此 parkCode（查詢為 0 筆）；URL 取自 www.nps.gov/seki 首頁 og:image（banner_image，仍為 NPS 官網資產）
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const ParkCoverOverride = require('../src/models/ParkCoverOverride');
const { clearParksNpsCache } = require('../src/controllers/parksController');

/** park_code 小寫 → 官方 www.nps.gov 圖片（非 Unsplash） */
const OFFICIAL_COVERS = [
  {
    park_code: 'seki',
    cover_image:
      'https://www.nps.gov/common/uploads/structured_data/3C7A250B-1DD8-B71B-0BCF61A89A8B2970.jpg',
  },
  {
    park_code: 'sequ',
    cover_image:
      'https://www.nps.gov/common/uploads/banner_image/pwr/homepage/14B0FC86-DB98-FED5-4605BEDEEB487B7B.jpg',
  },
  {
    park_code: 'yose',
    cover_image:
      'https://www.nps.gov/common/uploads/structured_data/3C84CC4C-1DD8-B71B-0BE967E5E5D93F25.jpg',
  },
  {
    park_code: 'hosp',
    cover_image:
      'https://www.nps.gov/common/uploads/structured_data/C0D8DFDD-F151-C5B0-3004B0088C98BA5A.jpg',
  },
  {
    park_code: 'jeff',
    cover_image:
      'https://www.nps.gov/common/uploads/structured_data/200BA7E6-D782-9A97-A8C36AC178DEB31C.jpg',
  },
];

function assertNoUnsplash(url, code) {
  if (!url || typeof url !== 'string') throw new Error(`${code}: 缺少 URL`);
  const u = url.toLowerCase();
  if (u.includes('unsplash.com') || u.includes('images.unsplash') || u.includes('source.unsplash')) {
    throw new Error(`${code}: 不可使用 Unsplash URL`);
  }
  if (!u.startsWith('https://www.nps.gov/')) {
    throw new Error(`${code}: 僅允許 https://www.nps.gov/ 官方網域`);
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('錯誤：請在 .env 設定 MONGODB_URI');
    process.exit(1);
  }

  for (const row of OFFICIAL_COVERS) {
    assertNoUnsplash(row.cover_image, row.park_code);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  for (const row of OFFICIAL_COVERS) {
    const doc = await ParkCoverOverride.findOneAndUpdate(
      { park_code: row.park_code },
      { $set: { cover_image: row.cover_image } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const u = doc.cover_image || '';
    console.log('upsert ok:', doc.park_code, u.length > 80 ? `${u.slice(0, 80)}…` : u);
  }

  clearParksNpsCache();
  console.log('已清除 /api/parks 的 NPS 記憶體快取（若伺服器在跑，下次請求會重抓並套用覆寫）。');

  await mongoose.disconnect();
  console.log('seedParks 完成。');
}

main().catch((err) => {
  console.error(err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
