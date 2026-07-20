// prices.js (نسخه بهینه برای سرورهای خارجی مثل Railway)

const CACHE_MS = 60 * 1000; // 1 دقیقه کش
let cache = { usdt: 91500, ton: 7.2, updatedAt: 0 }; // مقادیر پیش‌فرض برای جلوگیری از کرش

async function fetchGlobalPrices() {
  try {
    // گرفتن قیمت TON به دلار از API جهانی (بدون تحریم)
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
    const data = await res.json();
    
    const tonInUsd = data['the-open-network']?.usd;
    
    // نکته: برای قیمت تتر به تومان (چون مرجع جهانی ندارد)، 
    // یا یک عدد ثابت بگذار یا از یک API ایرانی که باز است استفاده کن.
    // فعلاً برای تست، قیمت تتر را روی یک عدد معقول ثابت نگه می‌داریم تا سرور بالا بیاید.
    const usdtInToman = 91000; 

    return {
      usdt: usdtInToman,
      ton: tonInUsd ? Math.floor(tonInUsd * usdtInToman) : null
    };
  } catch (e) {
    console.error('[Prices] Global fetch failed:', e.message);
    return null;
  }
}

export async function getLivePrices() {
  const now = Date.now();

  // اگر کمتر از 1 دقیقه از آپدیت قبلی گذشته، همان را برگردان
  if (now - cache.updatedAt < CACHE_MS && cache.updatedAt !== 0) {
    return { ...cache, live: false };
  }

  // تلاش برای آپدیت در پس‌زمینه (Non-blocking)
  fetchGlobalPrices().then(newPrices => {
    if (newPrices) {
      if (newPrices.usdt) cache.usdt = newPrices.usdt;
      if (newPrices.ton) cache.ton = newPrices.ton;
      cache.updatedAt = Date.now();
    }
  });

  // همیشه بلافاصله آخرین چیزی که در کش هست را برگردان (حتی اگر قدیمی باشد)
  // این کار باعث می‌شود سرور هیچ‌وقت منتظر API نماند و کرش نکند
  return {
    usdt: cache.usdt || 91000,
    ton: cache.ton || 0,
    updatedAt: cache.updatedAt,
    live: true
  };
}
