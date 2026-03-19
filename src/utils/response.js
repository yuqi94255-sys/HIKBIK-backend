/**
 * 標準化 API 回應：
 * - success：{ success: true, data: ..., message: "" }
 * - fail：{ success: false, error: "...", message: "..." }
 */
function ok(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    message: '',
  });
}

function fail(res, error, status = 400) {
  const message = typeof error === 'string' ? error : error?.message ?? '請求失敗';
  return res.status(status).json({
    success: false,
    error: message,
    message,
  });
}

module.exports = { ok, fail };
