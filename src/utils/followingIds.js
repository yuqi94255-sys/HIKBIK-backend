const mongoose = require('mongoose');

/**
 * 從 User 文件（lean 或 Document）取出 following 中有效的 ObjectId 字串陣列。
 */
function followingIdsFromUser(user) {
  if (!user) return [];
  const raw = Array.isArray(user.following) ? user.following : [];
  const out = [];
  for (const id of raw) {
    if (id == null) continue;
    const s = typeof id.toString === 'function' ? id.toString() : String(id);
    if (mongoose.Types.ObjectId.isValid(s)) out.push(s);
  }
  return out;
}

module.exports = { followingIdsFromUser };
