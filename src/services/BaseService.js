const axios = require('axios');
const { keysToSnakeCase } = require('../utils/snakeCase');

/**
 * HIKBIK 插件化服務基類
 * - 統一使用 axios 發送請求
 * - 自動將外部 API 回傳轉為 snake_case
 * - 標準錯誤攔截與格式化
 */
class BaseService {
  constructor(config = {}) {
    this.client = axios.create({
      timeout: config.timeout ?? 30000,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      ...config,
    });

    this.client.interceptors.response.use(
      (response) => {
        const data = response.data;
        response.data = keysToSnakeCase(data);
        return response;
      },
      (error) => {
        const normalized = this.normalizeError(error);
        return Promise.reject(normalized);
      }
    );
  }

  /**
   * 標準錯誤格式
   */
  normalizeError(err) {
    if (err.response) {
      return {
        status: err.response.status,
        message: err.response.data?.message ?? err.response.data?.error ?? err.message,
        data: err.response.data ? keysToSnakeCase(err.response.data) : undefined,
      };
    }
    return {
      status: 0,
      message: err.message || '網路或服務錯誤',
    };
  }

  /**
   * GET 請求，回傳 data 已轉 snake_case
   */
  async get(url, params = {}, options = {}) {
    const res = await this.client.get(url, { params, ...options });
    return res.data;
  }

  /**
   * POST 請求，回傳 data 已轉 snake_case
   */
  async post(url, data = {}, options = {}) {
    const res = await this.client.post(url, data, options);
    return res.data;
  }

  /**
   * PUT 請求
   */
  async put(url, data = {}, options = {}) {
    const res = await this.client.put(url, data, options);
    return res.data;
  }

  /**
   * PATCH 請求
   */
  async patch(url, data = {}, options = {}) {
    const res = await this.client.patch(url, data, options);
    return res.data;
  }

  /**
   * DELETE 請求
   */
  async delete(url, options = {}) {
    const res = await this.client.delete(url, options);
    return res.data;
  }

  /**
   * 是否已配置（有 baseURL 或 API Key）
   */
  isConfigured() {
    return !!(this.client.defaults.baseURL || this.apiKey);
  }
}

module.exports = BaseService;
