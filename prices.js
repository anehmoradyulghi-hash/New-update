// prices.js

const CACHE_MS = 30 * 1000; // 30 ثانیه کش
const REQUEST_TIMEOUT = 4000; // 4 ثانیه مهلت پاسخگویی

let cache = { usdt: null, ton: null, updatedAt: 0 };

/**
 * تابع کمکی برای ایجاد وقفه در صورت طولانی شدن ریکوئست
 */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function fetchNobitexPrice(symbol) {
  try {
    // اصلاح API نوبیتکس (استفاده از مارکت تومانی مستقیم اگر موجود باشد یا تبدیل ریال)
    // نوبیتکس برای تتر و تون جفت ارز rls (ریال) دارد
    const url = `https://api.nobitex.ir/market/stats?srcCurrency=${symbol}&dstCurrency=rls`;
    
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    const key = `${symbol}-rls`;
    const rialPrice = Number(data?.stats?.[key]?.latest);

    if (!rialPrice || isNaN(rialPrice)) return null;

    return Math.floor(rialPrice / 10); // تبدیل ریال به تومان
  } catch (e) {
    console.error(`[nobitex] ${symbol} fetch failed:`, e.message);
    return null; // در صورت خطا، مقدار null برمی‌گرداند تا ربات منتظر نماند
  }
}

/**
 * تابع اصلی برای گرفتن قیمت‌ها
 */
export async function getLivePrices() {
  const now = Date.now();

  // اگر کش معتبر است، همان را برگردان
  if (now - cache.updatedAt < CACHE_MS && cache.usdt !== null) {
    return { ...cache, live: false };
  }

  // تلاش برای گرفتن قیمت‌های جدید بدون اینکه کل برنامه منتظر بماند
  try {
    // استفاده از Promise.allSettled تا اگر یکی خطا داد، دومی متوقف نشود
    const results = await Promise.allSettled([
      fetchNobitexPrice('usdt'),
      fetchNobitexPrice('ton')
    ]);

    const usdt = results[0].status === 'fulfilled' ? results[0].value : null;
    const ton = results[1].status === 'fulfilled' ? results[1].value : null;

    // فقط اگر قیمت جدید آمد، کش را آپدیت کن
    if (usdt) cache.usdt = usdt;
    if (ton) cache.ton = ton;
    cache.updatedAt = now;

    return {
      usdt: usdt || cache.usdt, // اگر جدید نیومد، آخرین قیمت کش شده رو بده
      ton: ton || cache.ton,
      updatedAt: cache.updatedAt,
      live: !!(usdt || ton)
    };
  } catch (err) {
    console.error('[prices] Critical error in getLivePrices:', err.message);
    return { ...cache, live: false };
  }
}
