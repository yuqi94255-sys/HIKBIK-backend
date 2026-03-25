#!/usr/bin/env node
/**
 * 離線驗證：publish 摘要鍵名是否與前端 GrandJourneyItem / DetailedTrackItem 一致。
 * 邏輯來源：src/utils/socialPublishSummary.js（與正式 API 共用）
 *
 * 執行：node scripts/verify-align.js
 */

const path = require('path');
const {
  buildSummaryForPublish,
  FULL_SUMMARY_KEYS,
} = require(path.join(__dirname, '../src/utils/socialPublishSummary'));

/** 內建模板：宏觀旅程（COMMUNITY_MACRO） */
const TEMPLATE_MACRO = {
  journeyName: 'Pacific Coast — Week 1',
  totalDistance: 42.5,
  vehicle: 'Gravel',
  days: { count: 5 },
  dayPhotos: [
    { url: 'https://cdn.example.com/macro/cover.jpg' },
    { url: 'https://cdn.example.com/macro/day2.jpg' },
  ],
  images: ['https://cdn.example.com/macro/extra.png'],
};

/** 內建模板：微觀軌跡（COMMUNITY_MICRO） */
const TEMPLATE_MICRO = {
  routeName: 'Twin Peaks Loop',
  heroImage: 'https://cdn.example.com/micro/hero.webp',
  gallery: [
    'https://cdn.example.com/micro/g1.jpg',
    { url: 'https://cdn.example.com/micro/g2.jpg' },
  ],
  totalDistance: 12400,
  elevationGain: 380,
  durationMinutes: 80,
  activityType: 'Ride',
  trackTier: 'Nature',
  environment: 'ignored_when_trackTier_set',
};

/** 前端 GrandJourneyItem 應讀取的 summary 鍵（與產品約定一致） */
const GRAND_JOURNEY_ITEM_KEYS = [
  'id',
  'authorId',
  'authorName',
  'authorAvatarUrl',
  'authorSubtitle',
  'title',
  'coverImageUrl',
  'imageUrls',
  'likeCount',
  'commentCount',
  'days',
  'mileage',
  'vehicle',
];

/** 前端 DetailedTrackItem 應讀取的 summary 鍵 */
const DETAILED_TRACK_ITEM_KEYS = [
  'id',
  'authorId',
  'authorName',
  'authorAvatarUrl',
  'authorSubtitle',
  'title',
  'coverImageUrl',
  'imageUrls',
  'likeCount',
  'commentCount',
  'distance',
  'elevationGain',
  'durationDisplay',
  'activityType',
  'trackTier',
];

const MOCK_CTX = {
  postId: '507f1f77bcf86cd799439011',
  authorId: '507f191e810c19729de860ea',
  authorName: 'Test Rider',
  authorAvatarUrl: 'https://cdn.example.com/avatar.png',
  authorSubtitle: 'SF · 測試副標',
};

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

function keySetEquals(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((k, i) => k === sb[i]);
}

function subsetKeysPresent(subset, fullObject) {
  const keys = sortedKeys(fullObject);
  const missing = subset.filter((k) => !keys.includes(k));
  return { ok: missing.length === 0, missing };
}

function fmtVal(v) {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `[${v.length} items] ${JSON.stringify(v)}`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function printAsciiTable(rows) {
  const cols = ['欄位', '宏觀 (MACRO)', '微觀 (MICRO)'];
  const widths = [28, 36, 36];
  const line = () =>
    `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const cell = (text, w) => {
    const s = text.length > w ? `${text.slice(0, w - 1)}…` : text;
    return s.padEnd(w);
  };
  console.log(line());
  console.log(
    `| ${cell(cols[0], widths[0])} | ${cell(cols[1], widths[1])} | ${cell(cols[2], widths[2])} |`
  );
  console.log(line());
  for (const row of rows) {
    console.log(
      `| ${cell(row[0], widths[0])} | ${cell(row[1], widths[1])} | ${cell(row[2], widths[2])} |`
    );
  }
  console.log(line());
}

function main() {
  const macroSummary = buildSummaryForPublish(
    'COMMUNITY_MACRO',
    TEMPLATE_MACRO,
    MOCK_CTX
  );
  const microSummary = buildSummaryForPublish(
    'COMMUNITY_MICRO',
    TEMPLATE_MICRO,
    MOCK_CTX
  );

  const actualMacroKeys = sortedKeys(macroSummary);
  const actualMicroKeys = sortedKeys(microSummary);

  const fullMatch = keySetEquals(actualMacroKeys, actualMicroKeys);
  const fullMatchExpected = keySetEquals(
    actualMacroKeys,
    FULL_SUMMARY_KEYS
  );

  const gj = subsetKeysPresent(GRAND_JOURNEY_ITEM_KEYS, macroSummary);
  const dt = subsetKeysPresent(DETAILED_TRACK_ITEM_KEYS, microSummary);

  console.log('\n=== HIKBIK publish summary 對齊驗證 ===\n');
  console.log(
    '共用模組:',
    path.join(__dirname, '../src/utils/socialPublishSummary.js')
  );
  console.log('');

  console.log('【鍵集合】');
  console.log(
    `  FULL_SUMMARY_KEYS（預期 ${FULL_SUMMARY_KEYS.length} 個，已排序）:`,
    FULL_SUMMARY_KEYS.join(', ')
  );
  console.log(
    `  宏觀實際鍵數: ${actualMacroKeys.length}  微觀實際鍵數: ${actualMicroKeys.length}`
  );
  console.log(
    `  宏觀≡微觀鍵集合: ${fullMatch ? '✓ 一致' : '✗ 不一致'}`
  );
  console.log(
    `  實際鍵≡FULL_SUMMARY_KEYS: ${fullMatchExpected ? '✓ 一致' : '✗ 不一致'}`
  );
  console.log('');

  console.log('【卡片模型覆蓋】');
  console.log(
    `  GrandJourneyItem 所需鍵 ⊆ 宏觀 summary: ${gj.ok ? '✓' : '✗'} ${
      gj.ok ? '' : `(缺: ${gj.missing.join(', ')})`
    }`
  );
  console.log(
    `  DetailedTrackItem 所需鍵 ⊆ 微觀 summary: ${dt.ok ? '✓' : '✗'} ${
      dt.ok ? '' : `(缺: ${dt.missing.join(', ')})`
    }`
  );
  console.log('');

  const union = [...new Set([...FULL_SUMMARY_KEYS])];
  const rows = union.map((field) => [
    field,
    fmtVal(macroSummary[field]),
    fmtVal(microSummary[field]),
  ]);

  console.log('【對照表】（同一欄位在宏觀 / 微觀模板下的取值）\n');
  printAsciiTable(rows);

  if (!fullMatch || !fullMatchExpected || !gj.ok || !dt.ok) {
    console.log('\n驗證未通過，請檢查 socialPublishSummary 或前端鍵名。\n');
    process.exitCode = 1;
  } else {
    console.log('\n驗證通過：summary 鍵名與全兼容集合一致，且兩類卡片所需鍵皆存在。\n');
  }
}

main();
