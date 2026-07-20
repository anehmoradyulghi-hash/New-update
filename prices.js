// قیمت لحظه‌ای تتر و تون از نوبیتکس — با کش کوتاه‌مدت تا فشار زیادی به API نوبیتکس وارد نشه
const CACHE_MS = 30 * 1000; // نیم دقیقه
let cache = { usdt: null, ton: null, updatedAt: 0 };

async function fetchNobitexPrice(symbol) {
  try {
    const res = await fetch(`https://api.nobitex.ir/market/stats?srcCurrency=${symbol}&dstCurrency=rls`);
    const data = await res.json();
    const key = `${symbol}-rls`;
    const rialPrice = Number(data?.stats?.[key]?.latest);
    if (!rialPrice) return null;
    return Math.floor(rialPrice / 10); // نوبیتکس قیمت رو به ریال می‌ده، ما با تومان کار می‌کنیم
  } catch (e) {
    console.error('[nobitex]', symbol, e.message);
    return null;
  }
}

// همیشه یه قیمت برمی‌گردونه (حتی اگه API لحظه‌ای در دسترس نبود، آخرین قیمت معتبر رو نگه می‌داره)
export async function getLivePrices() {
  const now = Date.now();
  if (now - cache.updatedAt < CACHE_MS && cache.usdt && cache.ton) {
    return { usdt: cache.usdt, ton: cache.ton, updatedAt: cache.updatedAt, live: false };
  }
  const [usdt, ton] = await ([fetchNobitexPrice('usdt'), fetchNobitexPrice('ton')]);
  if (usdt) cache.usdt = usdt;
  if (ton) cache.ton = ton;
  cache.updatedAt = now;
  return { usdt: cache.usdt, ton: cache.ton, updatedAt: cache.updatedAt, live: !!(usdt && ton) };
}
