const db = require('./db');

// قیمت‌های پیش‌فرض
let cachedPrices = {
  ton: 300000,   // قیمت تومانی تون‌کوین
  usdt: 60000,   // قیمت تومانی تتر
  updatedAt: new Date().toISOString()
};

// بارگذاری اولیه قیمت‌ها از دیتابیس در صورت وجود
async function initPrices() {
  try {
    const storedTon = await db.getSetting('price_ton');
    const storedUsdt = await db.getSetting('price_usdt');
    if (storedTon) cachedPrices.ton = parseFloat(storedTon);
    if (storedUsdt) cachedPrices.usdt = parseFloat(storedUsdt);
  } catch (err) {
    console.error('Error loading initial prices from DB:', err.message);
  }
}

initPrices();

// دریافت قیمت‌های فعلی
async function getPrices() {
  return {
    ton: cachedPrices.ton,
    usdt: cachedPrices.usdt
  };
}

// ثبت قیمت‌های جدید دستی
async function setManualPrices(tonPrice, usdtPrice) {
  if (tonPrice && !isNaN(tonPrice)) {
    cachedPrices.ton = parseFloat(tonPrice);
    await db.setSetting('price_ton', tonPrice.toString());
  }
  if (usdtPrice && !isNaN(usdtPrice)) {
    cachedPrices.usdt = parseFloat(usdtPrice);
    await db.setSetting('price_usdt', usdtPrice.toString());
  }
  cachedPrices.updatedAt = new Date().toISOString();
  return cachedPrices;
}

module.exports = {
  getPrices,
  setManualPrices
};
