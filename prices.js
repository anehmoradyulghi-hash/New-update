// prices.js
import fetch from 'node-fetch';

// قیمت‌های پیش‌فرض اگر نوبیتکس جواب نداد (تومان)
const DEFAULT_USDT = 70000;
const DEFAULT_TON = 450000;

let cache = {
  usdt: DEFAULT_USDT,
  ton: DEFAULT_TON,
  updatedAt: 0,
  live: false
};

// تابع کمکی برای جلوگیری از انتظار طولانی
const fetchWithTimeout = async (url, timeout = 4000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    return null;
  }
};

async function fetchNobitexPrice(symbol) {
  try {
    const url = `https://api.nobitex.ir/market/stats?srcCurrency=${symbol}&dstCurrency=rls`;
    const res = await fetchWithTimeout(url);
    
    if (!res || !res.ok) return null;

    const data = await res.json();
    const rawPrice = data?.stats?.[`${symbol}-rls`]?.latest;
    
    if (!rawPrice) return null;

    // تبدیل ریال نوبیتکس به تومان
    return Math.floor(Number(rawPrice) / 10);
  } catch (error) {
    console.error(`Error fetching ${symbol} price:`, error.message);
    return null;
  }
}

export async function getLivePrices(force = false) {
  const now = Date.now();
  const CACHE_TTL = 60000; // یک دقیقه

  if (!force && (now - cache.updatedAt < CACHE_TTL)) {
    return cache;
  }

  // گرفتن قیمت‌ها به صورت موازی (Settled باعث می‌شود اگر یکی خراب بود، دیگری کار کند)
  const results = await Promise.allSettled([
    fetchNobitexPrice('usdt'),
    fetchNobitexPrice('ton')
  ]);

  const newUsdt = results[0].status === 'fulfilled' ? results[0].value : null;
  const newTon = results[1].status === 'fulfilled' ? results[1].value : null;

  cache = {
    usdt: newUsdt || cache.usdt || DEFAULT_USDT,
    ton: newTon || cache.ton || DEFAULT_TON,
    updatedAt: now,
    live: !!(newUsdt || newTon)
  };

  return cache;
}
