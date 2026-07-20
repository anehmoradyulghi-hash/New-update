// قیمت تتر/تون دیگه از هیچ API بیرونی گرفته نمی‌شه — ادمین خودش از پنل قیمت رو ثبت می‌کنه.
// این باعث می‌شه هیچ‌وقت یه فراخوانی شبکه‌ی بیرونی، ربات رو معلق یا کند نکنه.
import db from './db.js';

export async function getLivePrices() {
  const usdt = db.prepare(`SELECT price_toman FROM currencies WHERE code = 'USDT'`).get();
  const ton = db.prepare(`SELECT price_toman FROM currencies WHERE code = 'TON'`).get();
  return {
    usdt: usdt?.price_toman || null,
    ton: ton?.price_toman || null,
    updatedAt: Date.now(),
    manual: true,
  };
}
