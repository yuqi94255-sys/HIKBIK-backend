const BaseService = require('./BaseService');
const { keysToSnakeCase } = require('../utils/snakeCase');

const STRIPE_KEY = process.env.STRIPE_KEY ?? process.env.STRIPE_SECRET_KEY;

class PaymentService extends BaseService {
  constructor() {
    super();
    this.apiKey = STRIPE_KEY;
  }

  /** 建立支付意圖（預留對接 Stripe） */
  async createPaymentIntent(params = {}) {
    if (!this.apiKey) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 STRIPE_KEY 或 STRIPE_SECRET_KEY',
        client_secret: null,
      });
    }
    // TODO: Stripe API 對接
    // const Stripe = require('stripe'); const stripe = new Stripe(this.apiKey);
    // const intent = await stripe.paymentIntents.create({ ... });
    return keysToSnakeCase({
      status: 'ready_for_api_key',
      client_secret: null,
    });
  }

  /** 取得已儲存卡牌列表（預留） */
  async getSavedCards(userId) {
    if (!this.apiKey) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 STRIPE_KEY',
        cards: [],
      });
    }
    // TODO: Stripe Customers / PaymentMethods
    return keysToSnakeCase({ status: 'ready_for_api_key', cards: [] });
  }
}

module.exports = new PaymentService();
