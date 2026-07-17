const mongoose = require('mongoose');
const TripPlan = require('../models/TripPlan');
const { ok, fail } = require('../utils/response');

const VALID_ORIGINS = ['ai', 'diy'];
const VALID_STATUSES = ['draft', 'saved'];

/**
 * 把 Mongo doc 轉成 App 端好用的 shape（camelCase；plan 原樣回傳）。
 * 這條路徑不做 snake_case 轉換：plan 內部是 iOS CustomRoute 的 camelCase JSON，
 * 必須原封不動來回，否則 App 解不回 CustomRoute。
 */
function serialize(doc) {
  return {
    id: doc._id?.toString(),
    clientId: doc.clientId,
    origin: doc.origin,
    status: doc.status,
    name: doc.name ?? '',
    description: doc.description ?? '',
    coverImageURL: doc.coverImageURL ?? '',
    citySlug: doc.citySlug ?? '',
    defaultMode: doc.defaultMode ?? 'walking',
    notes: doc.notes ?? '',
    plan: doc.plan ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** 從 body 抽出 mirror 欄位（優先用 plan 內的值，body 頂層可覆蓋）。 */
function extractMirror(body) {
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : {};
  return {
    name: body.name ?? plan.name ?? 'Untitled Route',
    description: body.description ?? plan.description ?? '',
    coverImageURL: body.coverImageURL ?? plan.coverImageURL ?? '',
    citySlug: body.citySlug ?? plan.citySlug ?? '',
    defaultMode: body.defaultMode ?? plan.defaultMode ?? 'walking',
    notes: body.notes ?? plan.notes ?? '',
  };
}

/**
 * GET /api/trips?origin=ai|diy&status=draft|saved
 * 列出當前 user 的計劃（可選 origin / status 篩選），依 updatedAt 新→舊。
 */
async function listTripPlans(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const query = { userId };
    const { origin, status } = req.query || {};
    if (origin) {
      if (!VALID_ORIGINS.includes(origin)) return fail(res, '無效的 origin', 400);
      query.origin = origin;
    }
    if (status) {
      if (!VALID_STATUSES.includes(status)) return fail(res, '無效的 status', 400);
      query.status = status;
    }

    const docs = await TripPlan.find(query).sort({ updatedAt: -1 }).lean();
    return ok(res, { trips: docs.map(serialize) });
  } catch (err) {
    console.error('listTripPlans error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * POST /api/trips
 * 建立或更新（依 userId + clientId upsert）一份計劃。
 * Body: { clientId, origin, status, plan, name?, ... }
 */
async function upsertTripPlan(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const b = req.body || {};
    const clientId = (b.clientId || '').toString().trim();
    if (!clientId) return fail(res, '缺少 clientId', 400);
    if (!b.plan || typeof b.plan !== 'object') return fail(res, '缺少 plan', 400);

    const origin = VALID_ORIGINS.includes(b.origin) ? b.origin : 'diy';
    const status = VALID_STATUSES.includes(b.status) ? b.status : 'saved';

    const update = {
      userId,
      clientId,
      origin,
      status,
      plan: b.plan,
      ...extractMirror(b),
    };

    const doc = await TripPlan.findOneAndUpdate(
      { userId, clientId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return ok(res, { trip: serialize(doc) });
  } catch (err) {
    // 併發 upsert 可能撞唯一鍵；重試一次
    if (err && err.code === 11000) {
      try {
        const doc = await TripPlan.findOne({
          userId: req.user.id,
          clientId: (req.body.clientId || '').toString().trim(),
        }).lean();
        if (doc) return ok(res, { trip: serialize(doc) });
      } catch (_) {}
    }
    console.error('upsertTripPlan error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * GET /api/trips/:id
 * :id 可為 Mongo _id 或 clientId（App 端多半只握有 clientId）。
 */
async function getTripPlan(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const doc = await findOwned(userId, req.params.id);
    if (!doc) return fail(res, '找不到該計劃', 404);
    return ok(res, { trip: serialize(doc) });
  } catch (err) {
    console.error('getTripPlan error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * PATCH /api/trips/:id
 * 局部更新（可只改 status = draft↔saved，或替換 plan）。:id 為 _id 或 clientId。
 */
async function patchTripPlan(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const existing = await findOwned(userId, req.params.id);
    if (!existing) return fail(res, '找不到該計劃', 404);

    const b = req.body || {};
    const set = {};
    if (b.status !== undefined) {
      if (!VALID_STATUSES.includes(b.status)) return fail(res, '無效的 status', 400);
      set.status = b.status;
    }
    if (b.origin !== undefined) {
      if (!VALID_ORIGINS.includes(b.origin)) return fail(res, '無效的 origin', 400);
      set.origin = b.origin;
    }
    if (b.plan && typeof b.plan === 'object') {
      set.plan = b.plan;
      Object.assign(set, extractMirror(b));
    } else {
      // 沒帶 plan 時，仍允許單獨改頂層 mirror 欄位
      for (const k of ['name', 'description', 'coverImageURL', 'citySlug', 'defaultMode', 'notes']) {
        if (b[k] !== undefined) set[k] = b[k];
      }
    }

    if (Object.keys(set).length === 0) return fail(res, '沒有可更新的欄位', 400);

    const doc = await TripPlan.findByIdAndUpdate(existing._id, { $set: set }, { new: true }).lean();
    return ok(res, { trip: serialize(doc) });
  } catch (err) {
    console.error('patchTripPlan error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/**
 * DELETE /api/trips/:id  （:id 為 _id 或 clientId）
 */
async function deleteTripPlan(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, '未授權', 401);

    const existing = await findOwned(userId, req.params.id);
    if (!existing) return fail(res, '找不到該計劃', 404);

    await TripPlan.deleteOne({ _id: existing._id });
    return ok(res, { deleted: true, id: existing._id.toString(), clientId: existing.clientId });
  } catch (err) {
    console.error('deleteTripPlan error:', err);
    return fail(res, '服務暫時不可用', 503);
  }
}

/** 依 _id（若為合法 ObjectId）或 clientId 找出屬於該 user 的計劃。 */
async function findOwned(userId, idOrClientId) {
  const raw = (idOrClientId || '').toString().trim();
  if (!raw) return null;
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const byId = await TripPlan.findOne({ _id: raw, userId }).lean();
    if (byId) return byId;
  }
  return TripPlan.findOne({ clientId: raw, userId }).lean();
}

module.exports = {
  listTripPlans,
  upsertTripPlan,
  getTripPlan,
  patchTripPlan,
  deleteTripPlan,
};
