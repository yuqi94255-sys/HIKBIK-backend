/**
 * POST 路徑引擎 - 接收 GPS 經緯度數據
 */
function postTestPath(req, res) {
  const { lat, lng, points } = req.body;

  const received =
    points && Array.isArray(points)
      ? points
      : lat != null && lng != null
        ? [{ lat, lng }]
        : [];

  if (received.length === 0) {
    return res.status(400).json({
      success: false,
      message: '請提供 lat/lng 或 points 陣列',
    });
  }

  res.status(200).json({
    success: true,
    message: 'GPS 數據已接收',
    received: {
      count: received.length,
      points: received,
    },
  });
}

module.exports = {
  postTestPath,
};
