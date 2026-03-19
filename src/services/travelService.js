const axios = require('axios');
const NodeCache = require('node-cache');
const BaseService = require('./BaseService');
const { keysToSnakeCase } = require('../utils/snakeCase');

const RIDB_BASE =
  (process.env.RIDB_BASE_URL || 'https://ridb.recreation.gov/api/v1').replace(
    /\/?$/,
    '/'
  );

function getRidbApiKey() {
  return process.env.RIDB_API_KEY || '';
}

const AIRBNB_BASE = 'https://airbnb19.p.rapidapi.com/api/v2';

function getRapidApiKey() {
  return process.env.RAPIDAPI_KEY || '';
}

function getAirbnbHost() {
  return process.env.RAPIDAPI_HOST_AIRBNB || 'airbnb19.p.rapidapi.com';
}

const FLIGHTS_BASE = 'https://flights-scraper-sky.p.rapidapi.com';

function getFlightsHost() {
  return process.env.RAPIDAPI_HOST_FLIGHTS || 'flights-scraper-sky.p.rapidapi.com';
}

// 內存快取：15 分鐘（900 秒）
const travelCache = new NodeCache({ stdTTL: 900 });

/**
 * 從機票 API 回傳中取出航班/報價陣列
 */
function getFlightsList(data) {
  if (!data || typeof data !== 'object') return [];
  const list =
    data.data?.flights ??
    data.data?.quotes ??
    data.data?.itineraries ??
    data.flights ??
    data.quotes ??
    data.itineraries ??
    data.data?.data ??
    data.data ??
    (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

/**
 * 單筆航班映射為 HIKBIK snake_case：id, airline_name, price_formatted, departure_time, arrival_time, duration, is_direct, booking_url
 */
function mapFlight(item) {
  if (!item || typeof item !== 'object') return null;
  const leg = item.outbound ?? item.outboundLeg ?? item.legs?.[0] ?? item.segments?.[0] ?? item;
  const id = item.id ?? item.quoteId ?? item.quote_id ?? item.itineraryId ?? item.itinerary_id ?? null;
  const airline = item.carrier ?? item.airline ?? leg.carrier ?? leg.airline ?? item.marketingCarrier ?? {};
  const airlineName =
    typeof airline === 'string' ? airline : (airline.name ?? airline.caption ?? airline.code ?? '');
  const price = item.price ?? item.minPrice ?? item.min_price ?? leg.price ?? null;
  const priceFormatted =
    typeof price === 'string' ? price : (typeof price === 'number' ? `$${price}` : null);
  const dep = item.departure ?? leg.departure ?? leg.departureTime ?? leg.departure_time ?? item.departureTime ?? null;
  const arr = item.arrival ?? leg.arrival ?? leg.arrivalTime ?? leg.arrival_time ?? item.arrivalTime ?? null;
  const departureTime = typeof dep === 'string' ? dep : (dep?.time ?? dep?.dateTime ?? null);
  const arrivalTime = typeof arr === 'string' ? arr : (arr?.time ?? arr?.dateTime ?? null);
  const duration = item.duration ?? leg.duration ?? item.durationMinutes ?? leg.duration_minutes ?? null;
  const durationStr = duration != null ? (typeof duration === 'number' ? `${Math.floor(duration / 60)}h ${duration % 60}m` : String(duration)) : null;
  const isDirect = item.direct ?? item.isDirect ?? item.is_direct ?? (leg.direct ?? (item.stops === 0 || item.stops === '0'));
  const bookingUrl = item.bookingUrl ?? item.booking_url ?? item.url ?? item.deepLink ?? item.deep_link ?? null;
  return keysToSnakeCase({
    id: id != null ? String(id) : null,
    airline_name: String(airlineName || ''),
    price_formatted: priceFormatted,
    departure_time: departureTime,
    arrival_time: arrivalTime,
    duration: durationStr,
    is_direct: !!isDirect,
    booking_url: bookingUrl,
  });
}

/**
 * 從租車 API 回傳中取出車輛/報價陣列
 */
function getCarsList(data) {
  if (!data || typeof data !== 'object') return [];
  const list =
    data.data?.cars ??
    data.data?.vehicles ??
    data.data?.results ??
    data.cars ??
    data.vehicles ??
    data.results ??
    data.data?.data ??
    data.data ??
    (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

/**
 * 推斷 vehicle_type 是否為 SUV/Truck/Van（單車友善車型）
 */
function normalizeVehicleType(raw) {
  const s = String(raw ?? '').toUpperCase();
  if (/\b(SUV|SPORT.?UTILITY|CROSSOVER)\b/.test(s) || s.includes('SUV')) return 'SUV';
  if (/\b(TRUCK|PICKUP|PICK.?UP|PICK-UP)\b/.test(s)) return 'Truck';
  if (/\b(VAN|MINIVAN|MINI.?VAN|PASSENGER.?VAN|CARGO)\b/.test(s)) return 'Van';
  if (s) return s;
  return null;
}

/**
 * 單筆租車映射為 HIKBIK snake_case：id, car_model, vehicle_type, transmission, price_total, price_per_day, provider, image_url, booking_url
 * 為戶外/單車愛好者標註 vehicle_type（SUV/Truck/Van 可載單車）
 */
function mapCar(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.id ?? item.quoteId ?? item.quote_id ?? item.vehicleId ?? item.vehicle_id ?? null;
  const carModel =
    item.carModel ?? item.car_model ?? item.vehicleName ?? item.vehicle_name ?? item.name ?? item.title ?? item.type ?? '';
  const rawType = item.vehicleType ?? item.vehicle_type ?? item.carType ?? item.car_type ?? item.sippCode ?? item.sipp_code ?? '';
  const vehicleType = normalizeVehicleType(rawType);
  const transmission =
    item.transmission ?? item.transmissionType ?? item.transmission_type ?? item.gear ?? '';
  const transStr = transmission ? String(transmission).toLowerCase().includes('auto') ? '自動' : '手動' : null;
  const priceTotal = item.price ?? item.totalPrice ?? item.total_price ?? item.priceTotal ?? item.price_total ?? null;
  const pricePerDay = item.pricePerDay ?? item.price_per_day ?? item.dailyRate ?? item.daily_rate ?? (priceTotal != null && item.days ? Number(priceTotal) / Number(item.days) : null);
  const provider = item.provider ?? item.supplier ?? item.vendor ?? item.company ?? '';
  const imageUrl = item.imageUrl ?? item.image_url ?? item.image ?? item.thumbnail ?? item.photo ?? (item.images?.[0]?.url ?? item.images?.[0]);
  const bookingUrl = item.bookingUrl ?? item.booking_url ?? item.url ?? item.deepLink ?? item.deep_link ?? null;
  return keysToSnakeCase({
    id: id != null ? String(id) : null,
    car_model: String(carModel || ''),
    vehicle_type: vehicleType,
    transmission: transStr,
    price_total: priceTotal != null ? Number(priceTotal) : null,
    price_per_day: pricePerDay != null ? Number(pricePerDay) : null,
    provider: String(provider || ''),
    image_url: typeof imageUrl === 'string' ? imageUrl : (imageUrl?.url ?? imageUrl?.src ?? null),
    booking_url: bookingUrl,
  });
}

/**
 * 從 Airbnb 單筆房源取出第一張大圖 URL
 */
function firstStayImageUrl(item) {
  const images = item.images ?? item.photos ?? item.pictures ?? item.media ?? [];
  const arr = Array.isArray(images) ? images : [];
  const first = arr[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    return first.url ?? first.URL ?? first.large ?? first.medium ?? first.src ?? null;
  }
  const cover = item.coverPhoto ?? item.cover_photo ?? item.thumbnail ?? item.image;
  if (typeof cover === 'string') return cover;
  if (cover && typeof cover === 'object') return cover.url ?? cover.URL ?? null;
  return null;
}

/**
 * 將 Airbnb 單筆房源映射為 HIKBIK snake_case：id, name, price_formatted, rating, image_url, url
 * RapidAPI 結構：item.listing (id, title), item.contextualPictures[0].picture, item.structuredDisplayPrice.primaryLine.price
 */
function mapStay(item) {
  if (!item || typeof item !== 'object') return null;
  const listing = item.listing ?? item;
  const id = listing.id ?? item.id ?? item.listingId ?? item.listing_id ?? item.propertyId ?? item.property_id ?? null;
  const name = listing.title ?? listing.legacyName ?? listing.name ?? item.title ?? item.name ?? item.listingName ?? item.listing_name ?? '';
  const priceLine = item.structuredDisplayPrice?.primaryLine ?? item.structured_display_price?.primary_line;
  const priceStr = priceLine?.price ?? item.price ?? item.rate ?? item.nightlyPrice ?? item.priceFormatted;
  const priceFormatted =
    typeof priceStr === 'string' ? priceStr : (typeof priceStr === 'number' ? `$${priceStr}` : null);
  const rating = listing.rating ?? item.rating ?? item.starRating ?? item.star_rating ?? item.reviewScore ?? null;
  const url =
    item.url ??
    item.listingUrl ??
    item.listing_url ??
    (id ? `https://www.airbnb.com/rooms/${id}` : null);
  const pictures = item.contextualPictures ?? item.contextual_pictures ?? item.images ?? item.photos ?? [];
  const firstPic = Array.isArray(pictures) && pictures[0];
  const imageUrl =
    (firstPic && (firstPic.picture ?? firstPic.url ?? firstPic.URL)) ?? firstStayImageUrl(item);
  return keysToSnakeCase({
    id: id != null ? String(id) : null,
    name: String(name || ''),
    price_formatted: priceFormatted,
    rating: rating != null ? Number(rating) : null,
    image_url: imageUrl ?? null,
    url,
  });
}

/**
 * 從 Airbnb API 回傳中取出房源陣列（RapidAPI 為 data.data.list）
 */
function getStaysList(data) {
  if (!data || typeof data !== 'object') return [];
  const list =
    data.data?.list ??
    data.data?.data ??
    data.data?.listings ??
    data.data?.results ??
    data.listings ??
    data.results ??
    data.list ??
    data.data ??
    (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * 從 RIDB 的 EntityMedia 陣列取第一張圖的 URL
 * 支援 RECDATA 已轉 snake_case 或原始 camelCase
 */
function firstImageUrl(entityMedia) {
  const list = Array.isArray(entityMedia) ? entityMedia : [];
  const first = list[0];
  if (!first || typeof first !== 'object') return null;
  return (
    first.MediaURL ||
    first.media_url ||
    first.URL ||
    first.url ||
    null
  );
}

/**
 * 將 RIDB facility 洗成 HIKBIK snake_case：id, name, description, latitude, longitude, image_url
 * BaseService 會把鍵轉成 snake_case，連續大寫會變 _x_y_z（如 RecAreaID -> _rec_area_i_d）
 */
function mapFacility(raw) {
  const r = raw || {};
  const name =
    r.FacilityName ||
    r.facility_name ||
    r._facility_name ||
    r.RecAreaName ||
    r.rec_area_name ||
    r._rec_area_name ||
    '';
  const desc =
    r.FacilityDescription ||
    r.facility_description ||
    r._facility_description ||
    r.RecAreaDescription ||
    r.rec_area_description ||
    r._rec_area_description ||
    '';
  const lat =
    r.FacilityLatitude ??
    r.facility_latitude ??
    r._facility_latitude ??
    r.RecAreaLatitude ??
    r.rec_area_latitude ??
    r._rec_area_latitude ??
    null;
  const lon =
    r.FacilityLongitude ??
    r.facility_longitude ??
    r._facility_longitude ??
    r.RecAreaLongitude ??
    r.rec_area_longitude ??
    r._rec_area_longitude ??
    null;
  const media =
    r.EntityMedia ?? r.entity_media ?? r._entity_media ?? r.MEDIA ?? r.media ?? [];
  const id =
    r.FacilityID ??
    r.facility_id ??
    r._facility_i_d ??
    r.RecAreaID ??
    r.rec_area_id ??
    r._rec_area_i_d ??
    null;
  return keysToSnakeCase({
    id,
    name,
    description: stripHtml(desc),
    latitude: lat != null ? Number(lat) : null,
    longitude: lon != null ? Number(lon) : null,
    image_url: firstImageUrl(media),
  });
}

/**
 * 從 API 回傳中取出 RECDATA 陣列（BaseService 會把鍵轉成 snake_case，RECDATA -> _r_e_c_d_a_t_a）
 * 若已知 key 都找不到，則取第一個為陣列的屬性（相容各種轉寫）
 */
function getRecData(data) {
  if (!data || typeof data !== 'object') return [];
  const list =
    data.RECDATA ??
    data.recdata ??
    data._r_e_c_d_a_t_a ??
    data.RecData ??
    data.data ??
    (Array.isArray(data) ? data : []);
  if (Array.isArray(list) && list.length > 0) return list;
  const firstArrayKey = data && typeof data === 'object'
    ? Object.keys(data).find((k) => Array.isArray(data[k]) && data[k].length > 0)
    : null;
  return firstArrayKey ? data[firstArrayKey] : [];
}

class TravelService extends BaseService {
  constructor() {
    super({
      baseURL: RIDB_BASE,
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    // 每次請求帶上 API Key（支援啟動後寫入 .env）
    this.client.interceptors.request.use((config) => {
      const key = getRidbApiKey();
      if (key) config.headers.apikey = key;
      return config;
    });
  }

  isRidbConfigured() {
    return !!getRidbApiKey();
  }

  /**
   * 民宿搜尋：對接 RapidAPI Airbnb searchPropertyByPlaceId
   * 回傳 snake_case：id, name, price_formatted, rating, image_url, url
   */
  async searchStays(params = {}) {
    const apiKey = getRapidApiKey();
    const host = getAirbnbHost();
    if (!apiKey) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 RAPIDAPI_KEY',
        stays: [],
      });
    }

    const placeId =
      params.place_id ?? params.placeId ?? params.place ?? '';
    if (!placeId || String(placeId).trim() === '') {
      return keysToSnakeCase({
        status: 'missing_params',
        message: '請提供 place_id 參數（例如城市 Place ID）',
        stays: [],
      });
    }

    const cacheKey = `stays:${String(placeId).trim()}`;
    const cached = travelCache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`緩存命中：[${cacheKey}]`);
      return cached;
    }

    try {
      // 這裡未來將接 Redis 緩存以節省 API 費用
      const res = await axios.get(
        `${AIRBNB_BASE}/searchPropertyByPlaceId`,
        {
          params: { placeId: String(placeId).trim() },
          headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': host,
          },
          timeout: 15000,
        }
      );

      const data = res.data;
      const rawList = getStaysList(data);
      const stays = rawList.map(mapStay).filter(Boolean);

      const result = keysToSnakeCase({
        stays,
        total: stays.length,
      });
      travelCache.set(cacheKey, result);
      console.log(`📡 API Called：[${cacheKey}]`);
      return result;
    } catch (err) {
      const status = err.response?.status ?? 429;
      const msg =
        err.response?.data?.message ??
        err.response?.data?.error ??
        err.message ??
        '住宿搜尋暫時不可用';
      const isQuota = status === 429 || (msg && String(msg).toLowerCase().includes('quota'));
      const message = isQuota ? 'RapidAPI 額度已用完或請求過於頻繁' : msg;
      throw Object.assign(new Error(message), { status });
    }
  }

  /**
   * 機票搜尋：對接 RapidAPI Skyscanner 數據源 (flights-scraper-sky)
   * 參數：from_entity_id (起飛地 Entity ID 或 IATA 如 SFO), to_entity_id (目的地), depart_date (YYYY-MM-DD)
   * 回傳 snake_case：id, airline_name, price_formatted, departure_time, arrival_time, duration, is_direct, booking_url
   * 緩存邏輯：機票價格變動快，緩存時間建議設置為 15–30 分鐘，兼顧數據準確性與節省額度
   * 未來優化：若用戶輸入 "San Francisco"，可先呼叫 searchLocation 取得 entity_id 再查機票
   */
  async searchFlights(params = {}) {
    const apiKey = getRapidApiKey();
    const host = getFlightsHost();
    if (!apiKey) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 RAPIDAPI_KEY',
        flights: [],
      });
    }

    const fromId = params.from_entity_id ?? params.fromEntityId ?? params.origin ?? params.from ?? '';
    const toId = params.to_entity_id ?? params.toEntityId ?? params.destination ?? params.to ?? '';
    const departDate = params.depart_date ?? params.departDate ?? params.date ?? params.depart ?? '';
    if (!fromId || !toId || !departDate) {
      return keysToSnakeCase({
        status: 'missing_params',
        message: '請提供 from_entity_id、to_entity_id、depart_date（例：SFO, LAX, 2025-06-01）',
        flights: [],
      });
    }

    const cacheKey = `flights:${String(fromId).trim()}-${String(toId).trim()}-${String(departDate).trim()}`;
    const cached = travelCache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`緩存命中：[${cacheKey}]`);
      return cached;
    }

    try {
      // 緩存時間建議設置為 15–30 分鐘，兼顧數據準確性與節省額度
      const res = await axios.get(`${FLIGHTS_BASE}/web/flights/search`, {
        params: {
          from_entity_id: String(fromId).trim(),
          to_entity_id: String(toId).trim(),
          depart_date: String(departDate).trim(),
        },
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': host,
        },
        timeout: 20000,
      });

      const data = res.data;
      const rawList = getFlightsList(data);
      const flights = rawList.map(mapFlight).filter(Boolean);

      const result = keysToSnakeCase({
        flights,
        total: flights.length,
      });
      travelCache.set(cacheKey, result);
      console.log(`📡 API Called：[${cacheKey}]`);
      return result;
    } catch (err) {
      const status = err.response?.status ?? 429;
      const msg =
        err.response?.data?.message ??
        err.response?.data?.error ??
        err.message ??
        '機票搜尋暫時不可用';
      const isQuota = status === 429 || (msg && String(msg).toLowerCase().includes('quota'));
      const message = isQuota ? 'RapidAPI 額度已用完或請求過於頻繁' : msg;
      throw Object.assign(new Error(message), { status });
    }
  }

  /**
   * 租車搜尋：對接 RapidAPI Skyscanner 體系 (flights-scraper-sky) /web/car-hire/search
   * 參數：entity_id (地點 ID，可先透過 searchDestination 取得), pick_up_date, drop_off_date
   * 回傳 snake_case：id, car_model, vehicle_type (SUV/Truck/Van 單車友善), transmission, price_total, price_per_day, provider, image_url, booking_url
   * 優化預留：若 API 需先 searchDestination 拿 entity_id，可在 controller 串接或由前端傳入已查好的 ID
   */
  async searchCars(params = {}) {
    const apiKey = getRapidApiKey();
    const host = getFlightsHost();
    if (!apiKey) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 RAPIDAPI_KEY',
        cars: [],
      });
    }

    const entityId = params.entity_id ?? params.entityId ?? params.location_id ?? params.locationId ?? params.place_id ?? '';
    const pickUp = params.pick_up_date ?? params.pickUpDate ?? params.pickup_date ?? params.start_date ?? '';
    const dropOff = params.drop_off_date ?? params.dropOffDate ?? params.dropoff_date ?? params.end_date ?? '';
    if (!entityId || !pickUp || !dropOff) {
      return keysToSnakeCase({
        status: 'missing_params',
        message: '請提供 entity_id、pick_up_date、drop_off_date（例：可先呼叫 searchDestination 取得 entity_id）',
        cars: [],
      });
    }

    const cacheKey = `cars:${String(entityId).trim()}-${String(pickUp).trim()}-${String(dropOff).trim()}`;
    const cached = travelCache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`緩存命中：[${cacheKey}]`);
      return cached;
    }

    try {
      const res = await axios.get(`${FLIGHTS_BASE}/web/car-hire/search`, {
        params: {
          entity_id: String(entityId).trim(),
          pick_up_date: String(pickUp).trim(),
          drop_off_date: String(dropOff).trim(),
        },
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': host,
        },
        timeout: 20000,
      });

      const data = res.data;
      const rawList = getCarsList(data);
      const cars = rawList.map(mapCar).filter(Boolean);

      const result = keysToSnakeCase({
        cars,
        total: cars.length,
      });
      travelCache.set(cacheKey, result);
      console.log(`📡 API Called：[${cacheKey}]`);
      return result;
    } catch (err) {
      const status = err.response?.status ?? 429;
      const msg =
        err.response?.data?.message ??
        err.response?.data?.error ??
        err.message ??
        '租車搜尋暫時不可用';
      const isQuota = status === 429 || (msg && String(msg).toLowerCase().includes('quota'));
      const message = isQuota ? 'RapidAPI 額度已用完或請求過於頻繁' : msg;
      throw Object.assign(new Error(message), { status });
    }
  }

  /**
   * 營地搜尋：呼叫 RIDB /facilities，過濾 facility_type_description 為 'Camping'
   * 參數：query, latitude, longitude, radius
   */
  async searchCamps(params = {}) {
    if (!this.isRidbConfigured()) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 RIDB_API_KEY',
        camps: [],
      });
    }

    try {
      const queryParams = {};
      if (params.query != null && String(params.query).trim() !== '') {
        queryParams.query = String(params.query).trim();
      }
      if (params.latitude != null) {
        queryParams.latitude = Number(params.latitude);
      }
      if (params.longitude != null) {
        queryParams.longitude = Number(params.longitude);
      }
      if (params.radius != null) {
        queryParams.radius = Number(params.radius);
      }
      queryParams.limit = Math.min(Number(params.limit) || 50, 50);
      queryParams.offset = Math.max(0, Number(params.offset) || 0);

      const data = await this.get('/facilities', queryParams);
      const rawList = getRecData(data);

      const camps = rawList
        .filter((item) => {
          const type =
            item.FacilityTypeDescription ??
            item.facility_type_description ??
            item._facility_type_description ??
            '';
          const t = String(type).toLowerCase();
          return t.includes('camping') || t.includes('campground') || t.includes('camp');
        })
        .map(mapFacility);

      return keysToSnakeCase({
        camps,
        total: camps.length,
      });
    } catch (err) {
      const status = err.status === 401 ? 401 : err.status || 503;
      const message =
        err.status === 401
          ? 'RIDB API Key 無效或已過期'
          : (err.message || 'RIDB 服務暫時不可用');
      throw Object.assign(new Error(message), { status });
    }
  }

  /**
   * 公園/遊憩區搜尋：呼叫 RIDB /recareas
   * 參數：query, latitude, longitude, radius（API 支援則帶入）
   */
  async searchParks(params = {}) {
    if (!this.isRidbConfigured()) {
      return keysToSnakeCase({
        status: 'ready_for_api_key',
        message: '請設定 RIDB_API_KEY',
        parks: [],
      });
    }

    try {
      const queryParams = {};
      if (params.query != null && String(params.query).trim() !== '') {
        queryParams.query = String(params.query).trim();
      }
      if (params.latitude != null) {
        queryParams.latitude = Number(params.latitude);
      }
      if (params.longitude != null) {
        queryParams.longitude = Number(params.longitude);
      }
      if (params.radius != null) {
        queryParams.radius = Number(params.radius);
      }
      queryParams.limit = Math.min(Number(params.limit) || 50, 50);
      queryParams.offset = Math.max(0, Number(params.offset) || 0);

      const data = await this.get('/recareas', queryParams);
      const rawList = getRecData(data);

      const parks = rawList.map(mapFacility);

      return keysToSnakeCase({
        parks,
        total: parks.length,
      });
    } catch (err) {
      const status = err.status === 401 ? 401 : err.status || 503;
      const message =
        err.status === 401
          ? 'RIDB API Key 無效或已過期'
          : (err.message || 'RIDB 服務暫時不可用');
      throw Object.assign(new Error(message), { status });
    }
  }
}

module.exports = new TravelService();
