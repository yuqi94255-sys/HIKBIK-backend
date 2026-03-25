/**
 * 社群發佈 summary 建構（對齊 CommunityDiscoveryView / GrandJourneyItem / DetailedTrackItem）
 * 由 socialController 與 scripts/verify-align.js 共用，避免漂移。
 */

function firstImageUrlFromList(list) {
  if (list == null) return '';
  const arr = Array.isArray(list) ? list : [list];
  const first = arr[0];
  if (first == null) return '';
  if (typeof first === 'string') return first;
  if (typeof first === 'object') {
    return String(
      first.url ?? first.imageUrl ?? first.imageURL ?? first.src ?? first.photoUrl ?? ''
    );
  }
  return '';
}

function heroImageToUrl(hero) {
  if (hero == null) return '';
  if (typeof hero === 'string') return hero;
  if (typeof hero === 'object') {
    return String(hero.url ?? hero.imageUrl ?? hero.src ?? '');
  }
  return '';
}

function collectImageUrlsMacro(payload) {
  const out = [];
  const push = (u) => {
    if (u && typeof u === 'string') out.push(u);
  };
  const walk = (list) => {
    if (list == null) return;
    const arr = Array.isArray(list) ? list : [list];
    for (const item of arr) {
      if (typeof item === 'string') push(item);
      else if (item && typeof item === 'object') {
        if (Array.isArray(item.photos)) {
          walk(item.photos);
        } else {
          push(firstImageUrlFromList([item]));
        }
      }
    }
  };
  walk(payload.dayPhotos);
  walk(payload.images);
  return [...new Set(out)];
}

function collectImageUrlsMicro(payload) {
  const out = [];
  const h = heroImageToUrl(payload.heroImage);
  if (h) out.push(h);
  const gallery = payload.gallery ?? payload.images;
  if (Array.isArray(gallery)) {
    for (const p of gallery) {
      const u = typeof p === 'string' ? p : firstImageUrlFromList([p]);
      if (u) out.push(u);
    }
  }
  return [...new Set(out)];
}

/** 將里程格式化成可讀字串（km） */
function formatMileageKm(raw) {
  if (raw == null || raw === '') return '';
  const n = Number(raw);
  if (Number.isNaN(n)) return String(raw);
  if (n > 500) {
    return `${(n / 1000).toFixed(1)} km`;
  }
  return `${n.toFixed(1)} km`;
}

function formatDurationDisplay(payload) {
  if (payload.durationDisplay && typeof payload.durationDisplay === 'string') {
    return payload.durationDisplay.trim();
  }
  const sec = payload.durationSeconds ?? payload.totalDurationSeconds;
  const minOnly = payload.durationMinutes ?? payload.totalDurationMinutes;
  if (minOnly != null && minOnly !== '') {
    const m = Math.round(Number(minOnly));
    if (Number.isNaN(m)) return '';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
  }
  if (sec != null && typeof sec === 'number' && !Number.isNaN(sec)) {
    const totalMin = Math.round(sec / 60);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
  }
  const d = payload.duration;
  if (typeof d === 'number' && d > 0 && d <= 240) {
    return `${Math.round(d)} min`;
  }
  return '';
}

function normalizeTrackTier(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).toLowerCase();
  if (s === 'nature' || s.includes('nature')) return 'Nature';
  if (s === 'urban' || s.includes('urban')) return 'Urban';
  const t = String(raw).trim();
  if (t === 'Nature' || t === 'Urban') return t;
  return '';
}

/**
 * @param {'COMMUNITY_MACRO'|'COMMUNITY_MICRO'} postCategory
 * @param {object} payload
 * @param {{ postId: string, authorId: string, authorName?: string, authorAvatarUrl?: string, authorSubtitle?: string }} ctx
 * @returns {object} 全兼容 summary（固定鍵集合，與前端卡片模型一致）
 */
function buildSummaryForPublish(postCategory, payload, ctx) {
  const {
    postId,
    authorId,
    authorName = '',
    authorAvatarUrl = '',
    authorSubtitle = '',
  } = ctx;

  const idStr = postId == null ? '' : String(postId);
  const authorIdStr = authorId == null ? '' : String(authorId);

  const base = {
    id: idStr,
    authorId: authorIdStr,
    authorName: String(authorName || '').trim() || 'Explorer',
    authorAvatarUrl: String(authorAvatarUrl || ''),
    authorSubtitle: String(authorSubtitle || ''),
    title: '',
    coverImageUrl: '',
    imageUrls: [],
    likeCount: 0,
    commentCount: 0,
    days: null,
    mileage: '',
    vehicle: '',
    distance: '',
    elevationGain: null,
    durationDisplay: '',
    activityType: '',
    trackTier: '',
  };

  if (postCategory === 'COMMUNITY_MACRO') {
    base.title = String(payload.journeyName ?? '').trim();
    base.coverImageUrl =
      firstImageUrlFromList(payload.dayPhotos) || firstImageUrlFromList(payload.images);
    base.imageUrls = collectImageUrlsMacro(payload);
    const daysObj = payload.days;
    let daysCount = null;
    if (daysObj != null && typeof daysObj === 'object' && 'count' in daysObj) {
      daysCount = Number(daysObj.count);
    } else if (typeof daysObj === 'number') {
      daysCount = daysObj;
    }
    base.days = daysCount != null && !Number.isNaN(daysCount) ? daysCount : null;
    base.mileage = formatMileageKm(payload.totalDistance);
    base.vehicle = String(payload.vehicle ?? '').trim();
  } else {
    base.title = String(payload.routeName ?? '').trim();
    base.coverImageUrl = heroImageToUrl(payload.heroImage);
    base.imageUrls = collectImageUrlsMicro(payload);
    const distRaw =
      payload.distance ?? payload.totalDistance ?? payload.totalDistanceKm ?? null;
    base.distance = formatMileageKm(distRaw);
    base.elevationGain =
      payload.elevationGain ?? payload.elevation ?? payload.totalAscent ?? null;
    base.durationDisplay = formatDurationDisplay(payload);
    base.activityType = String(payload.activityType ?? payload.type ?? '').trim();
    base.trackTier = normalizeTrackTier(payload.trackTier ?? payload.environment);
  }

  return base;
}

/** 與 buildSummaryForPublish 產物鍵集合一致（供驗證腳本；勿與實作漂移） */
const FULL_SUMMARY_KEYS = Object.freeze(
  [
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
    'distance',
    'elevationGain',
    'durationDisplay',
    'activityType',
    'trackTier',
  ].sort()
);

module.exports = {
  buildSummaryForPublish,
  FULL_SUMMARY_KEYS,
  formatMileageKm,
  formatDurationDisplay,
  normalizeTrackTier,
};
