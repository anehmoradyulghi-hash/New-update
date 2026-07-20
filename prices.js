// قیمت لحظه‌ای تتر و تون از نوبیتکس — با کش کوتاه‌مدت
const CACHE_MS = 30 * 1000; // 30 ثانیه
const REQUEST_TIMEOUT_MS = 2500; // حداکثر زمان انتظار هر درخواست

let cache = {
  usdt: null,
  ton: null,
  updatedAt: 0
};

async function fetchWithTimeout(url, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNobitexPrice(symbol) {
  try {
    // API نوبیتکس قیمت را به ریال برمی‌گرداند
    const url = `https://api.nobitex.ir/market/stats?srcCurrency=${symbol}&dstCurrency=rls`;
    const data = await fetchWithTimeout(url);

    const key = `${symbol}-rls`;
    const rialPrice = Number(data?.stats?.[key]?.latest);

    if (!rialPrice || Number.isNaN(rialPrice)) {
      return null;
    }

    // تبدیل ریال به تومان
    return Math.floor(rialPrice / 10);
  } catch (e) {
    console.error(`[nobitex] ${symbol}:`, e.message);
    return null;
  }
}

// همیشه سریع برمی‌گردد و اگر قیمت در دسترس نبود null می‌دهد
export async function getLivePrices() {
  const now = Date.now();

  // اگر کش هنوز معتبر بود، همان را بده
  if (now - cache.updatedAt < CACHE_MS) {
    return {
      usdt: cache.usdt,
      ton: cache.ton,
      updatedAt: cache.updatedAt,
      live: false
    };
  }

  // هر درخواست مستقل است؛ اگر یکی fail شد، کل تابع fail نمی‌شود
  const [usdtResult, tonResult] = await Promise.allSettled([
    fetchNobitexPrice('usdt'),
    fetchNobitexPrice('ton')
  ]);

  const usdt = usdtResult.status === 'fulfilled' ? usdtResult.value : null;
  const ton = tonResult.status === 'fulfilled' ? tonResult.value : null;

  // فقط مقادیر معتبر را در کش نگه دار
  if (usdt !== null) cache.usdt = usdt;
  if (ton !== null) cache.ton = ton;

  cache.updatedAt = now;

  return {
    usdt: usdt ?? null,
    ton: ton ?? null,
    updatedAt: cache.updatedAt,
    live: usdt !== null || ton !== null
  };
}
