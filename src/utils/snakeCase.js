/**
 * 將物件鍵轉為 snake_case（對齊 APIClientBase / 前端）
 */
function toSnakeCase(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

function keysToSnakeCase(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(keysToSnakeCase);
  if (typeof obj === 'object' && obj.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[toSnakeCase(k)] = keysToSnakeCase(v);
    }
    return out;
  }
  return obj;
}

/** 從 body 讀取 snake_case 或 camelCase */
function pickBody(body, snakeKeys) {
  const out = {};
  for (const sk of snakeKeys) {
    const ck = sk.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (body[sk] !== undefined) out[ck] = body[sk];
    else if (body[ck] !== undefined) out[ck] = body[ck];
  }
  return out;
}

module.exports = { toSnakeCase, keysToSnakeCase, pickBody };