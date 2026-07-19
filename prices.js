// قیمت لحظه‌ای تتر و تون از نوبیتکس — با کش کوتاه‌مدت تا فشار زیادی به API نوبیتکس وارد نشه
const CACHE_MS = 30 * 1000; // نیم دقیقه
const REQUEST_TIMEOUT_MS = 6 * 1000; // اگه نوبیتکس تا ۶ ثانیه جواب نده، دیگه منتظرش نمی‌مونیم

let cache = { usdt: null, ton: null, updatedAt: 0 };

async function fetchNobitexPrice(symbol) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(https://api.nobitex.ir/market/stats?srcCurrency=${symbol}&dstCurrency=rls, {
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('[nobitex]', symbol, 'http status', res.status);
      return null;
    }
    const data = await res.json();
    const key = ${symbol}-rls;
    const rialPrice = Number(data?.stats?.[key]?.latest);
    if (!rialPrice) return null;
    return Math.floor(rialPrice / 10); // نوبیتکس قیمت رو به ریال می‌ده، ما با تومان کار می‌کنیم
  } catch (e) {
    // شامل حالت timeout (AbortError) و هر خطای شبکه‌ی دیگه (مثلاً فیلتر بودن API روی سرور)
    console.error('[nobitex]', symbol, e.name === 'AbortError' ? timeout after ${REQUEST_TIMEOUT_MS}ms : e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// همیشه یه قیمت برمی‌گردونه (حتی اگه API لحظه‌ای در دسترس نبود، آخرین قیمت معتبر رو نگه می‌داره)
// این تابع حداکثر REQUEST_TIMEOUT_MS طول می‌کشه؛ هیچ‌وقت هنگ نمی‌کنه و صفحه رو قفل نمی‌کنه.
export async function getLivePrices() {
  const now = Date.now();
  if (now - cache.updatedAt < CACHE_MS && cache.usdt && cache.ton) {
    return { usdt: cache.usdt, ton: cache.ton, updatedAt: cache.updatedAt, live: false };
  }
  const [usdt, ton] = await Promise.all([fetchNobitexPrice('usdt'), fetchNobitexPrice('ton')]);
  if (usdt) cache.usdt = usdt;
  if (ton) cache.ton = ton;
  cache.updatedAt = now;
  return { usdt: cache.usdt, ton: cache.ton, updatedAt: cache.updatedAt, live: !!(usdt && ton) };
}
