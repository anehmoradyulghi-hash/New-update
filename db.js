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
  staked_rial INTEGER NOT NULL DEFAULT 0,
  stake_started_at TEXT,
  ref_code TEXT UNIQUE,
  referred_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'link',   -- join_channel | link
  channel_username TEXT,               -- برای type=join_channel، بدون @
  link TEXT,                           -- برای type=link
  reward_rial INTEGER NOT NULL DEFAULT 0,
  reward_stars INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tg_id, task_id)
);

CREATE TABLE IF NOT EXISTS gift_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_tg_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT,
  category TEXT,
  price_rial INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'listed', -- listed | reserved | completed | cancelled | disputed
  buyer_tg_id INTEGER,
  escrow_amount INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  reserved_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS gift_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '🎁'
);

CREATE TABLE IF NOT EXISTS manual_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  amount_rial INTEGER NOT NULL,
  tracking_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_rial INTEGER NOT NULL,
  image_url TEXT,
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
  note TEXT,                         -- گیرنده/آیدی اکانت هدف که خریدار وارد کرده
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

// ===================== SAFE MIGRATIONS (برای دیتابیس‌هایی که قبلاً دیپلوی شده‌اند) =====================
function tryAddColumn(sql) {
  try { db.exec(sql); } catch (e) { /* column already exists — ignore */ }
}
tryAddColumn(`ALTER TABLE products ADD COLUMN image_url TEXT`);
tryAddColumn(`ALTER TABLE orders ADD COLUMN note TEXT`);
tryAddColumn(`ALTER TABLE users ADD COLUMN staked_rial INTEGER NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE users ADD COLUMN stake_started_at TEXT`);
tryAddColumn(`ALTER TABLE users ADD COLUMN last_spin_at TEXT`);
tryAddColumn(`ALTER TABLE gift_listings ADD COLUMN category TEXT`);

// دسته‌بندی‌های پیش‌فرض بازار گیفت (فقط یک‌بار)
const gcSeed = db.prepare('SELECT COUNT(*) c FROM gift_categories').get();
if (gcSeed.c === 0) {
  const insertCat = db.prepare('INSERT INTO gift_categories (name, icon) VALUES (?,?)');
  [['عمومی','🎁'], ['کلکسیونی','💎'], ['محدود','🔥']].forEach(([name, icon]) => insertCat.run(name, icon));
}

// ===================== SEED PRODUCTS (run once) =====================
const seed = db.prepare('SELECT COUNT(*) c FROM products').get();
if (seed.c === 0) {
  const insert = db.prepare(`INSERT INTO products (id, category, name, description, price_rial) VALUES (?,?,?,?,?)`);
  const seedData = [
    ['st100', 'stars', '۱۰۰ استارز', 'واریز آنی به اکانت تلگرام', 39000],
    ['st500', 'stars', '۵۰۰ استارز', 'واریز آنی + ۵٪ تخفیف حجمی', 185000],
    ['pm1', 'premium', 'پرمیوم ۱ ماهه', 'فعال‌سازی مستقیم — آیدی اکانت مقصد رو موقع خرید وارد کن', 169000],
    ['gc-gp', 'gift', 'گیفت‌کارت Google Play ۲۰$', 'کد دیجیتال', 1150000],
  ];
  const tx = db.transaction((rows) => rows.forEach(r => insert.run(...r)));
  tx(seedData);
}

// مارکت گیفت (گیفت‌های پروفایل تلگرام) — جدا از سید بالا تا رو دیتابیس‌های قبلی هم اضافه بشه
const giftMarketSeed = db.prepare(`SELECT COUNT(*) c FROM products WHERE category='giftmarket'`).get();
if (giftMarketSeed.c === 0) {
  const insert = db.prepare(`INSERT INTO products (id, category, name, description, price_rial) VALUES (?,?,?,?,?)`);
  const rows = [
    ['gm-rose', 'giftmarket', 'گیفت رز 🌹', 'ارسال به پروفایل هر کاربر — آیدی گیرنده رو موقع خرید وارد کن', 79000],
    ['gm-heart', 'giftmarket', 'گیفت قلب ❤️', 'ارسال به پروفایل هر کاربر — آیدی گیرنده رو موقع خرید وارد کن', 79000],
    ['gm-diamond', 'giftmarket', 'گیفت الماس 💎', 'گیفت ویژه با نمایش خاص در پروفایل', 349000],
    ['gm-crown', 'giftmarket', 'گیفت تاج 👑', 'کمیاب‌ترین گیفت مارکت', 890000],
  ];
  const tx = db.transaction((data) => data.forEach(r => insert.run(...r)));
  tx(rows);
}

// تسک‌های پیش‌فرض (فقط یک‌بار)
const taskSeed = db.prepare('SELECT COUNT(*) c FROM tasks').get();
if (taskSeed.c === 0) {
  db.prepare(`INSERT INTO tasks (id, title, description, type, channel_username, reward_rial, active) VALUES (?,?,?,?,?,?,1)`)
    .run('join-main-channel', 'عضویت در کانال استارکده', 'عضو کانال شو و ۱۰,۰۰۰ تومان جایزه بگیر', 'join_channel', 'starkadeh_channel', 10000);
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

export function createOrder(tgId, productId, qty, amountRial, payMethod, note = null) {
  const info = db.prepare(`INSERT INTO orders (tg_id, product_id, qty, amount_rial, pay_method, status, note) VALUES (?,?,?,?,?, 'paid', ?)`)
    .run(tgId, productId, qty, amountRial, payMethod, note);
  return info.lastInsertRowid;
}

export function getProduct(id) {
  return db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
}

/* ===================== STAKING ===================== */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// محاسبه و واریز پاداش انباشته‌شده تا همین لحظه، بعد تایمر رو ریست می‌کنه (checkpoint)
export function settleStake(tgId, aprPercent) {
  const user = getUser(tgId);
  if (!user.staked_rial || !user.stake_started_at) return;
  const elapsedMs = Date.now() - new Date(user.stake_started_at + 'Z').getTime();
  const reward = Math.floor(user.staked_rial * (aprPercent / 100) * (elapsedMs / YEAR_MS));
  db.prepare(`UPDATE users SET stake_started_at = datetime('now') WHERE tg_id = ?`).run(tgId);
  if (reward > 0) {
    adjustBalance(tgId, 'rial', reward, 'پاداش استیکینگ');
  }
}

export function pendingStakeReward(user, aprPercent) {
  if (!user.staked_rial || !user.stake_started_at) return 0;
  const elapsedMs = Date.now() - new Date(user.stake_started_at + 'Z').getTime();
  return Math.floor(user.staked_rial * (aprPercent / 100) * (elapsedMs / YEAR_MS));
}

export function stakeDeposit(tgId, amount, aprPercent, capRial) {
  settleStake(tgId, aprPercent);
  const user = getUser(tgId);
  if (user.balance_rial < amount) throw new Error('موجودی کیف‌پول کافی نیست');
  if (user.staked_rial + amount > capRial) throw new Error(`سقف استیکینگ ${capRial.toLocaleString()} تومانه`);
  db.prepare(`UPDATE users SET balance_rial = balance_rial - ?, staked_rial = staked_rial + ?, stake_started_at = COALESCE(stake_started_at, datetime('now')) WHERE tg_id = ?`)
    .run(amount, amount, tgId);
  db.prepare(`INSERT INTO transactions (tg_id, type, currency, amount, reason) VALUES (?,?,?,?,?)`)
    .run(tgId, 'out', 'rial', amount, 'واریز به استیکینگ');
}

export function stakeWithdraw(tgId, amount, aprPercent) {
  settleStake(tgId, aprPercent);
  const user = getUser(tgId);
  if (amount > user.staked_rial) throw new Error('مبلغ بیشتر از موجودی استیک‌شده است');
  db.prepare(`UPDATE users SET balance_rial = balance_rial + ?, staked_rial = staked_rial - ? WHERE tg_id = ?`)
    .run(amount, amount, tgId);
  db.prepare(`INSERT INTO transactions (tg_id, type, currency, amount, reason) VALUES (?,?,?,?,?)`)
    .run(tgId, 'in', 'rial', amount, 'برداشت از استیکینگ');
}

/* ===================== TASKS ===================== */
export function listActiveTasks() {
  return db.prepare('SELECT * FROM tasks WHERE active = 1 ORDER BY created_at').all();
}
export function isTaskDone(tgId, taskId) {
  return !!db.prepare('SELECT 1 FROM task_completions WHERE tg_id = ? AND task_id = ?').get(tgId, taskId);
}
export function completeTask(tgId, task) {
  db.prepare('INSERT OR IGNORE INTO task_completions (tg_id, task_id) VALUES (?,?)').run(tgId, task.id);
  if (task.reward_rial) adjustBalance(tgId, 'rial', task.reward_rial, `پاداش تسک: ${task.title}`);
  if (task.reward_stars) adjustBalance(tgId, 'stars', task.reward_stars, `پاداش تسک: ${task.title}`);
}

export default db;

/* ===================== GIFT MARKET (P2P, escrow-based — مثل پرتال) =====================
   کاربر گیفت واقعی خودش رو (که تو تلگرام داره) اینجا لیست می‌کنه.
   پول خریدار موقع خرید بلوکه می‌شه (امانت)، فروشنده گیفت رو دستی تو تلگرام می‌فرسته،
   خریدار دریافتش رو تایید می‌کنه و تازه اونوقت پول (منهای کارمزد) آزاد می‌شه.
   ================================================================================== */
export function createListing(sellerTgId, title, imageUrl, category, price) {
  const info = db.prepare(`INSERT INTO gift_listings (seller_tg_id, title, image_url, category, price_rial) VALUES (?,?,?,?,?)`)
    .run(sellerTgId, title, imageUrl || null, category || null, price);
  return info.lastInsertRowid;
}
export function getListing(id) {
  return db.prepare('SELECT * FROM gift_listings WHERE id = ?').get(id);
}
export function getMarketListings(excludeTgId, category) {
  if (category) {
    return db.prepare(`
      SELECT g.*, u.username, u.first_name FROM gift_listings g
      JOIN users u ON u.tg_id = g.seller_tg_id
      WHERE g.status = 'listed' AND g.seller_tg_id != ? AND g.category = ?
      ORDER BY g.created_at DESC
    `).all(excludeTgId, category);
  }
  return db.prepare(`
    SELECT g.*, u.username, u.first_name FROM gift_listings g
    JOIN users u ON u.tg_id = g.seller_tg_id
    WHERE g.status = 'listed' AND g.seller_tg_id != ?
    ORDER BY g.created_at DESC
  `).all(excludeTgId);
}
export function listGiftCategories() {
  return db.prepare('SELECT * FROM gift_categories ORDER BY id').all();
}
export function addGiftCategory(name, icon) {
  db.prepare('INSERT INTO gift_categories (name, icon) VALUES (?,?)').run(name, icon || '🎁');
}
export function deleteGiftCategory(id) {
  db.prepare('DELETE FROM gift_categories WHERE id = ?').run(id);
}
export function getMyListings(tgId) {
  return db.prepare(`
    SELECT g.*,
      su.username AS seller_username, su.first_name AS seller_first_name,
      bu.username AS buyer_username, bu.first_name AS buyer_first_name
    FROM gift_listings g
    LEFT JOIN users su ON su.tg_id = g.seller_tg_id
    LEFT JOIN users bu ON bu.tg_id = g.buyer_tg_id
    WHERE g.seller_tg_id = ? OR g.buyer_tg_id = ?
    ORDER BY g.created_at DESC
  `).all(tgId, tgId);
}
export function cancelListing(sellerTgId, id) {
  const g = getListing(id);
  if (!g || g.seller_tg_id !== Number(sellerTgId)) throw new Error('این آگهی مال تو نیست');
  if (g.status !== 'listed') throw new Error('فقط آگهی‌های هنوز نفروخته قابل لغوه');
  db.prepare(`UPDATE gift_listings SET status = 'cancelled' WHERE id = ?`).run(id);
}
export function reserveListing(buyerTgId, id) {
  const g = getListing(id);
  if (!g) throw new Error('آگهی پیدا نشد');
  if (g.status !== 'listed') throw new Error('این گیفت دیگه در دسترس نیست');
  if (g.seller_tg_id === Number(buyerTgId)) throw new Error('نمی‌تونی گیفت خودتو بخری');
  const buyer = getUser(buyerTgId);
  if (buyer.balance_rial < g.price_rial) throw new Error('موجودی کیف‌پول کافی نیست');

  adjustBalance(buyerTgId, 'rial', -g.price_rial, `پرداخت امانی برای گیفت «${g.title}»`, String(id));
  db.prepare(`UPDATE gift_listings SET status='reserved', buyer_tg_id=?, escrow_amount=?, reserved_at=datetime('now') WHERE id=?`)
    .run(buyerTgId, g.price_rial, id);
  return g;
}
export function confirmReceived(buyerTgId, id, feePercent) {
  const g = getListing(id);
  if (!g) throw new Error('آگهی پیدا نشد');
  if (g.buyer_tg_id !== Number(buyerTgId)) throw new Error('این معامله مال تو نیست');
  if (g.status !== 'reserved') throw new Error('این معامله در وضعیت قابل‌تاییدی نیست');

  const fee = Math.floor(g.escrow_amount * (feePercent / 100));
  const sellerReceives = g.escrow_amount - fee;
  adjustBalance(g.seller_tg_id, 'rial', sellerReceives, `فروش گیفت «${g.title}» در بازار کاربران`, String(id));
  db.prepare(`UPDATE gift_listings SET status='completed', completed_at=datetime('now') WHERE id=?`).run(id);
  return { ...g, sellerReceives };
}
// ادمین برای حل اختلاف: یا پول رو به فروشنده آزاد می‌کنه یا به خریدار برمی‌گردونه
export function adminResolveListing(id, action, feePercent) {
  const g = getListing(id);
  if (!g || g.status !== 'reserved') throw new Error('قابل رسیدگی نیست');
  if (action === 'release') {
    const fee = Math.floor(g.escrow_amount * (feePercent / 100));
    adjustBalance(g.seller_tg_id, 'rial', g.escrow_amount - fee, `آزادسازی امانت توسط ادمین — گیفت «${g.title}»`, String(id));
    db.prepare(`UPDATE gift_listings SET status='completed', completed_at=datetime('now') WHERE id=?`).run(id);
  } else if (action === 'refund') {
    adjustBalance(g.buyer_tg_id, 'rial', g.escrow_amount, `بازگشت وجه توسط ادمین — گیفت «${g.title}»`, String(id));
    db.prepare(`UPDATE gift_listings SET status='cancelled' WHERE id=?`).run(id);
  } else throw new Error('عملیات نامعتبر');
  return g;
}
export function getAllListingsForAdmin() {
  return db.prepare(`
    SELECT g.*,
      su.username AS seller_username, su.first_name AS seller_first_name,
      bu.username AS buyer_username, bu.first_name AS buyer_first_name
    FROM gift_listings g
    LEFT JOIN users su ON su.tg_id = g.seller_tg_id
    LEFT JOIN users bu ON bu.tg_id = g.buyer_tg_id
    ORDER BY g.created_at DESC LIMIT 200
  `).all();
}

/* ===================== MANUAL CARD-TO-CARD PAYMENTS ===================== */
export function createManualPayment(tgId, amountRial, trackingCode) {
  const info = db.prepare(`INSERT INTO manual_payments (tg_id, amount_rial, tracking_code) VALUES (?,?,?)`)
    .run(tgId, amountRial, trackingCode);
  return info.lastInsertRowid;
}
export function getManualPayment(id) {
  return db.prepare('SELECT * FROM manual_payments WHERE id = ?').get(id);
}
export function setManualPaymentStatus(id, status) {
  db.prepare('UPDATE manual_payments SET status = ? WHERE id = ?').run(status, id);
}
