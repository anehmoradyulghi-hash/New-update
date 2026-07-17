import Database from 'better-sqlite3';

const db = new Database('starkadeh.db');
db.pragma('journal_mode = WAL');

// ===================== SCHEMA =====================
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance_rial INTEGER NOT NULL DEFAULT 0,
  balance_stars INTEGER NOT NULL DEFAULT 0,
  ref_code TEXT UNIQUE,
  referred_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_rial INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  amount_rial INTEGER NOT NULL,
  pay_method TEXT NOT NULL,          -- wallet | stars | gateway
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | delivered | failed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  type TEXT NOT NULL,                -- in | out
  currency TEXT NOT NULL,            -- rial | stars
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gateway_payments (
  authority TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL,
  amount_rial INTEGER NOT NULL,
  purpose TEXT NOT NULL,             -- topup | order:<id>
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ===================== SEED PRODUCTS (run once) =====================
const seed = db.prepare('SELECT COUNT(*) c FROM products').get();
if (seed.c === 0) {
  const insert = db.prepare(`INSERT INTO products (id, category, name, description, price_rial) VALUES (?,?,?,?,?)`);
  const seedData = [
    ['st100', 'stars', '۱۰۰ استارز', 'واریز آنی به اکانت تلگرام', 39000],
    ['st500', 'stars', '۵۰۰ استارز', 'واریز آنی + ۵٪ تخفیف حجمی', 185000],
    ['pm1', 'premium', 'پرمیوم ۱ ماهه', 'فعال‌سازی مستقیم', 169000],
    ['gc-gp', 'gift', 'گیفت‌کارت Google Play ۲۰$', 'کد دیجیتال', 1150000],
  ];
  const tx = db.transaction((rows) => rows.forEach(r => insert.run(...r)));
  tx(seedData);
}

// ===================== HELPERS =====================
export function getOrCreateUser(tgUser, referrerCode) {
  let user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgUser.id);
  if (!user) {
    const refCode = 'ref_' + tgUser.id;
    let referredBy = null;
    if (referrerCode) {
      const referrer = db.prepare('SELECT tg_id FROM users WHERE ref_code = ?').get(referrerCode);
      if (referrer && referrer.tg_id !== tgUser.id) referredBy = referrer.tg_id;
    }
    db.prepare(`INSERT INTO users (tg_id, username, first_name, ref_code, referred_by) VALUES (?,?,?,?,?)`)
      .run(tgUser.id, tgUser.username || null, tgUser.first_name || null, refCode, referredBy);
    user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgUser.id);
  }
  return user;
}

export function getUser(tgId) {
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
}

export function adjustBalance(tgId, currency, delta, reason, refId = null) {
  const col = currency === 'stars' ? 'balance_stars' : 'balance_rial';
  db.prepare(`UPDATE users SET ${col} = ${col} + ? WHERE tg_id = ?`).run(delta, tgId);
  db.prepare(`INSERT INTO transactions (tg_id, type, currency, amount, reason, ref_id) VALUES (?,?,?,?,?,?)`)
    .run(tgId, delta >= 0 ? 'in' : 'out', currency, Math.abs(delta), reason, refId);
}

// 10% referral commission credited to the referrer's rial balance when a paid order is confirmed
export function payReferralCommission(buyerTgId, orderAmountRial) {
  const buyer = getUser(buyerTgId);
  if (buyer && buyer.referred_by) {
    const commission = Math.floor(orderAmountRial * 0.10);
    if (commission > 0) {
      adjustBalance(buyer.referred_by, 'rial', commission, 'پورسانت رفرال از خرید زیرمجموعه', String(buyerTgId));
    }
  }
}

export function createOrder(tgId, productId, qty, amountRial, payMethod) {
  const info = db.prepare(`INSERT INTO orders (tg_id, product_id, qty, amount_rial, pay_method, status) VALUES (?,?,?,?,?, 'paid')`)
    .run(tgId, productId, qty, amountRial, payMethod);
  return info.lastInsertRowid;
}

export function getProduct(id) {
  return db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
}

export default db;
