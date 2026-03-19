const BaseService = require('./BaseService');
const { keysToSnakeCase } = require('../utils/snakeCase');

const OPENWEATHER_BASE =
  (process.env.OPENWEATHER_BASE_URL || 'https://api.openweathermap.org/data/2.5').replace(
    /\/?$/,
    '/'
  );
const ICON_BASE = 'https://openweathermap.org/img/wn';

function getAppId() {
  return process.env.OPENWEATHER_APPID || process.env.OPENWEATHER_API_KEY || '';
}

class WeatherService extends BaseService {
  constructor() {
    super({
      baseURL: OPENWEATHER_BASE,
      timeout: 15000,
    });
  }

  isConfigured() {
    return !!getAppId();
  }

  /**
   * 取得當前天氣（緯度經度）
   * 調用 OpenWeather API，帶上 units=metric、lang=zh_tw
   * 只回傳：temp, feels_like, description, icon_url（snake_case）
   */
  async getWeather(lat, lon) {
    if (!this.isConfigured()) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 OPENWEATHER_API_KEY',
        temp: null,
        feels_like: null,
        description: null,
        icon_url: null,
      });
    }

    try {
      const appId = getAppId();
      const data = await this.get('/weather', {
        lat,
        lon,
        appid: appId,
        units: 'metric',
        lang: 'zh_tw',
      });

      const main = data.main || {};
      const weather =
        Array.isArray(data.weather) && data.weather[0] ? data.weather[0] : {};
      const icon = weather.icon || '';
      const iconUrl = icon ? `${ICON_BASE}/${icon}@2x.png` : null;

      return keysToSnakeCase({
        temp: main.temp != null ? main.temp : null,
        feels_like: main.feels_like != null ? main.feels_like : null,
        description: weather.description || null,
        icon_url: iconUrl,
      });
    } catch (err) {
      const status = err.status === 401 ? 401 : err.status || 503;
      const message =
        err.status === 401
          ? 'OpenWeather API Key 無效或已過期'
          : (err.message || '天氣服務暫時不可用');
      throw Object.assign(new Error(message), { status });
    }
  }
}

module.exports = new WeatherService();
