const BaseService = require('./BaseService');
const { keysToSnakeCase } = require('../utils/snakeCase');

const EASYPOST_API_KEY = process.env.EASYPOST_API_KEY;
const SHIPPING_API_URL = process.env.SHIPPING_API_URL;

class ShippingService extends BaseService {
  constructor() {
    super({ baseURL: SHIPPING_API_URL || 'https://api.easypost.com/v2' });
    this.apiKey = EASYPOST_API_KEY;
  }

  /** 取得運費報價（預留對接 EasyPost 等） */
  async getRates(params = {}) {
    if (!this.apiKey) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 EASYPOST_API_KEY 或 SHIPPING_API_URL',
        rates: [],
      });
    }
    // TODO: 對接真實 API
    return keysToSnakeCase({ status: 'ready_for_api_key', rates: [] });
  }

  /** 查詢包裹軌跡（預留） */
  async trackPackage(trackingNumber) {
    if (!this.apiKey) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 EASYPOST_API_KEY',
        tracking: null,
      });
    }
    // TODO: 對接真實 API
    return keysToSnakeCase({
      status: 'ready_for_api_key',
      tracking: null,
    });
  }
}

module.exports = new ShippingService();
