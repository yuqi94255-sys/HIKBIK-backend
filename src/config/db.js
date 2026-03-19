const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function connectDB() {
  if (!MONGODB_URI) {
    console.warn('未設定 MONGODB_URI，驗證登入與用戶資料接口將不可用');
    return null;
  }
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB 已連線');
    return mongoose.connection;
  } catch (err) {
    console.error('-------- MongoDB 連線失敗（詳細日誌）--------');
    console.error('錯誤名稱:', err.name);
    console.error('錯誤訊息:', err.message);
    console.error('錯誤代碼:', err.code || '(無)');
    if (err.cause) console.error('原因:', err.cause);
    if (err.reason) console.error('reason:', err.reason);
    console.error('完整錯誤:', err);
    console.error('---------------------------------------------');
    console.error('若為 querySrv ECONNREFUSED，請檢查：');
    console.error('  1. MongoDB Atlas 網路存取 → IP 白名單是否包含 0.0.0.0/0（允許所有）或您當前 IP');
    console.error('  2. 本機 DNS 是否可解析 cluster0.ng9v7fa.mongodb.net');
    console.error('  3. 防火牆/公司網路是否封鎖出站 27017 或 SRV 查詢');
    throw err;
  }
}

module.exports = { connectDB, mongoose };
