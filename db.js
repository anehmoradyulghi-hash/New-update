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

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,              -- مثلاً TON, USDT
  name TEXT NOT NULL,
  icon TEXT DEFAULT '💰',
  deposit_address TEXT,
  deposit_note TEXT,                  -- توضیح اضافه (شبکه، مموی و...)
  min_amount REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_balances (
  tg_id INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (tg_id, currency_code)
);

CREATE TABLE IF NOT EXISTS currency_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  type TEXT NOT NULL,                 -- deposit | withdraw
  amount REAL NOT NULL,
  address TEXT,                       -- برای withdraw: آدرس مقصد کاربر
  tx_hash TEXT,                       -- برای deposit: هش تراکنش/کد رهگیری
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  power INTEGER NOT NULL DEFAULT 10,
  description TEXT,
  currency_code TEXT NOT NULL DEFAULT 'RIAL', -- RIAL | STARS | کد ارز دیگه از جدول currencies
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  acquired_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  card_ids TEXT NOT NULL,     -- JSON array از user_cards.id
  power INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | matched | expired | cancelled
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player1_tg_id INTEGER NOT NULL,
  player2_tg_id INTEGER NOT NULL,
  player1_power INTEGER NOT NULL,
  player2_power INTEGER NOT NULL,
  winner_tg_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_scores (
  tg_id INTEGER PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender TEXT NOT NULL, -- user | admin
  text TEXT,
  image_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leaderboard_prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rank_from INTEGER NOT NULL,
  rank_to INTEGER NOT NULL,
  prize_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS card_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'link',   -- join_channel | link
  channel_username TEXT,
  link TEXT,
  reward_card_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_task_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tg_id, task_id)
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
tryAddColumn(`ALTER TABLE users ADD COLUMN matches_played_today INTEGER NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE users ADD COLUMN extra_plays INTEGER NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE users ADD COLUMN last_match_date TEXT`);
tryAddColumn(`ALTER TABLE tasks ADD COLUMN reward_card_id TEXT`);
tryAddColumn(`ALTER TABLE user_cards ADD COLUMN level INTEGER NOT NULL DEFAULT 1`);
tryAddColumn(`ALTER TABLE game_cards ADD COLUMN upgrade_cost REAL NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE game_cards ADD COLUMN upgrade_currency TEXT NOT NULL DEFAULT 'RIAL'`);
tryAddColumn(`ALTER TABLE game_cards ADD COLUMN max_level INTEGER NOT NULL DEFAULT 5`);
tryAddColumn(`ALTER TABLE game_cards ADD COLUMN power_per_level INTEGER NOT NULL DEFAULT 5`);
tryAddColumn(`ALTER TABLE user_cards ADD COLUMN bonus_power INTEGER NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE game_matches ADD COLUMN player1_cards TEXT`);
tryAddColumn(`ALTER TABLE game_matches ADD COLUMN player2_cards TEXT`);
tryAddColumn(`ALTER TABLE currencies ADD COLUMN price_toman REAL NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE game_cards ADD COLUMN purchase_limit INTEGER`); // NULL = نامحدود، عدد = حداکثر تعداد خرید هر کاربر
tryAddColumn(`ALTER TABLE game_cards ADD COLUMN level_images TEXT`); // JSON: {"1":"url","2":"url",...}
tryAddColumn(`ALTER TABLE game_cards ADD COLUMN sacrifice_bonus_percent INTEGER NOT NULL DEFAULT 50`);
tryAddColumn(`ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE users ADD COLUMN ban_reason TEXT`);
tryAddColumn(`ALTER TABLE gift_listings ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'RIAL'`);
tryAddColumn(`ALTER TABLE gift_listings ADD COLUMN category TEXT`);

// ارزهای ثابت پلتفرم — فقط تتر و تون(گرام)، دیگه از پنل نمی‌شه ارز جدید اضافه کرد
const curSeed = db.prepare('SELECT COUNT(*) c FROM currencies').get();
if (curSeed.c === 0) {
  db.prepare(`INSERT INTO currencies (code, name, icon, deposit_address, deposit_note, min_amount, active) VALUES (?,?,?,?,?,?,1)`)
    .run('USDT', 'تتر (USDT)', '💵', null, 'شبکه TRC20', 1);
  db.prepare(`INSERT INTO currencies (code, name, icon, deposit_address, deposit_note, min_amount, active) VALUES (?,?,?,?,?,?,1)`)
    .run('TON', 'تون (گرام)', '💎', null, 'شبکه TON', 1);
}

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
  if (task.reward_card_id) db.prepare('INSERT INTO user_cards (tg_id, card_id) VALUES (?,?)').run(tgId, task.reward_card_id);
}

export default db;

/* ===================== CARD GAME (shop, matchmaking, leaderboard) ===================== */

// ---- shop / cards ----
export function listGameCards(activeOnly = true) {
  return activeOnly
    ? db.prepare('SELECT * FROM game_cards WHERE active = 1 ORDER BY power DESC').all()
    : db.prepare('SELECT * FROM game_cards ORDER BY created_at DESC').all();
}
export function getGameCard(id) {
  return db.prepare('SELECT * FROM game_cards WHERE id = ?').get(id);
}
export function addGameCard(id, name, imageUrl, power, description, currencyCode, price, upgradeCost, upgradeCurrency, maxLevel, powerPerLevel, purchaseLimit, sacrificeBonusPercent) {
  db.prepare(`INSERT INTO game_cards (id, name, image_url, power, description, currency_code, price, upgrade_cost, upgrade_currency, max_level, power_per_level, purchase_limit, sacrifice_bonus_percent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name, imageUrl || null, power, description || '', currencyCode, price, upgradeCost || 0, upgradeCurrency || 'RIAL', maxLevel || 5, powerPerLevel || 5, purchaseLimit || null, sacrificeBonusPercent || 50);
}
export function updateGameCard(id, fields) {
  const c = getGameCard(id);
  if (!c) throw new Error('کارت پیدا نشد');
  db.prepare(`UPDATE game_cards SET name=?, image_url=?, power=?, description=?, currency_code=?, price=?, upgrade_cost=?, upgrade_currency=?, max_level=?, power_per_level=?, purchase_limit=?, sacrifice_bonus_percent=?, level_images=?, active=? WHERE id=?`)
    .run(fields.name ?? c.name, fields.image_url ?? c.image_url, fields.power ?? c.power, fields.description ?? c.description,
         fields.currency_code ?? c.currency_code, fields.price ?? c.price,
         fields.upgrade_cost ?? c.upgrade_cost, fields.upgrade_currency ?? c.upgrade_currency,
         fields.max_level ?? c.max_level, fields.power_per_level ?? c.power_per_level,
         fields.purchase_limit === undefined ? c.purchase_limit : fields.purchase_limit,
         fields.sacrifice_bonus_percent ?? c.sacrifice_bonus_percent,
         fields.level_images === undefined ? c.level_images : fields.level_images,
         fields.active ?? c.active, id);
}
export function deleteGameCard(id) {
  db.prepare('DELETE FROM game_cards WHERE id = ?').run(id);
}
export function effectivePower(card, level, bonusPower = 0) {
  return card.power + (level - 1) * card.power_per_level + (bonusPower || 0);
}
// عکس مخصوص همون سطح رو برمی‌گردونه، وگرنه عکس پایه کارت
export function cardImageForLevel(card, level) {
  if (card.level_images) {
    try {
      const map = JSON.parse(card.level_images);
      if (map[level]) return map[level];
    } catch (e) {}
  }
  return card.image_url;
}

// ---- inventory ----
export function grantCard(tgId, cardId) {
  db.prepare('INSERT INTO user_cards (tg_id, card_id) VALUES (?,?)').run(tgId, cardId);
}
export function countUserCopiesOfCard(tgId, cardId) {
  return db.prepare('SELECT COUNT(*) c FROM user_cards WHERE tg_id = ? AND card_id = ?').get(tgId, cardId).c;
}
export function getUserCards(tgId) {
  const rows = db.prepare(`
    SELECT uc.id AS user_card_id, uc.acquired_at, uc.level, uc.bonus_power, c.*
    FROM user_cards uc JOIN game_cards c ON c.id = uc.card_id
    WHERE uc.tg_id = ? ORDER BY uc.acquired_at DESC
  `).all(tgId);
  return rows.map(r => ({
    ...r,
    effective_power: effectivePower(r, r.level, r.bonus_power),
    display_image: cardImageForLevel(r, r.level),
  }));
}
export function upgradeUserCard(tgId, userCardId) {
  const row = db.prepare(`
    SELECT uc.*, c.max_level, c.power_per_level, c.upgrade_cost, c.upgrade_currency, c.name
    FROM user_cards uc JOIN game_cards c ON c.id = uc.card_id
    WHERE uc.id = ?
  `).get(userCardId);
  if (!row || row.tg_id !== Number(tgId)) throw new Error('این کارت مال تو نیست');
  if (row.level >= row.max_level) throw new Error('این کارت به حداکثر سطح رسیده');

  const cost = row.upgrade_cost * row.level; // هر سطح گرون‌تر از قبلی
  if (cost > 0) {
    if (row.upgrade_currency === 'RIAL') {
      const user = getUser(tgId);
      if (user.balance_rial < cost) throw new Error('موجودی ریالی کافی نیست');
      adjustBalance(tgId, 'rial', -cost, `ارتقای کارت «${row.name}»`);
    } else if (row.upgrade_currency === 'STARS') {
      const user = getUser(tgId);
      if (user.balance_stars < cost) throw new Error('موجودی استارز کافی نیست');
      adjustBalance(tgId, 'stars', -cost, `ارتقای کارت «${row.name}»`);
    } else {
      const bal = getCurrencyBalance(tgId, row.upgrade_currency);
      if (bal < cost) throw new Error(`موجودی ${row.upgrade_currency} کافی نیست`);
      adjustCurrencyBalance(tgId, row.upgrade_currency, -cost);
    }
  }
  db.prepare('UPDATE user_cards SET level = level + 1 WHERE id = ?').run(userCardId);
  return { newLevel: row.level + 1, cost };
}

// ارتقا با قربانی کردن یک کارت دیگه — درصد بونوس هر کارت از پنل قابل تنظیمه (پیش‌فرض ۵۰٪)
export function sacrificeUpgradeCard(tgId, targetUserCardId, sacrificeUserCardId) {
  if (targetUserCardId === sacrificeUserCardId) throw new Error('نمی‌تونی یه کارت رو قربانی خودش کنی');
  const target = db.prepare(`
    SELECT uc.*, c.name, c.power_per_level FROM user_cards uc JOIN game_cards c ON c.id = uc.card_id WHERE uc.id = ?
  `).get(targetUserCardId);
  const sac = db.prepare(`
    SELECT uc.*, c.power, c.power_per_level, c.sacrifice_bonus_percent FROM user_cards uc JOIN game_cards c ON c.id = uc.card_id WHERE uc.id = ?
  `).get(sacrificeUserCardId);
  if (!target || target.tg_id !== Number(tgId)) throw new Error('کارت هدف مال تو نیست');
  if (!sac || sac.tg_id !== Number(tgId)) throw new Error('کارت قربانی مال تو نیست');

  const sacPower = effectivePower(sac, sac.level, sac.bonus_power);
  const boost = Math.floor(sacPower * (sac.sacrifice_bonus_percent / 100));

  db.prepare('DELETE FROM user_cards WHERE id = ?').run(sacrificeUserCardId);
  db.prepare('UPDATE user_cards SET bonus_power = bonus_power + ? WHERE id = ?').run(boost, targetUserCardId);
  return { boost, sacrificedName: sac.card_id };
}
// می‌خرد و مستقیم به کیف‌پول (ریال/استارز/ارز دیگه) وصل می‌شه؛ خرید فوریه چون قیمت‌ها از قبل مشخصن
export function buyGameCard(tgId, cardId) {
  const card = getGameCard(cardId);
  if (!card || !card.active) throw new Error('کارت در دسترس نیست');
  if (card.purchase_limit) {
    const owned = countUserCopiesOfCard(tgId, cardId);
    if (owned >= card.purchase_limit) throw new Error('این کارت فقط یک‌بار قابل خریده و قبلاً خریدیش');
  }
  if (card.currency_code === 'RIAL') {
    const user = getUser(tgId);
    if (user.balance_rial < card.price) throw new Error('موجودی ریالی کافی نیست');
    adjustBalance(tgId, 'rial', -card.price, `خرید کارت «${card.name}»`);
  } else if (card.currency_code === 'STARS') {
    const user = getUser(tgId);
    if (user.balance_stars < card.price) throw new Error('موجودی استارز کافی نیست');
    adjustBalance(tgId, 'stars', -card.price, `خرید کارت «${card.name}»`);
  } else {
    const bal = getCurrencyBalance(tgId, card.currency_code);
    if (bal < card.price) throw new Error(`موجودی ${card.currency_code} کافی نیست`);
    adjustCurrencyBalance(tgId, card.currency_code, -card.price);
  }
  grantCard(tgId, cardId);
}

// ---- daily play limit ----
function todayStr() { return new Date().toISOString().slice(0, 10); }
export function ensureDailyReset(tgId) {
  const user = getUser(tgId);
  if (user.last_match_date !== todayStr()) {
    db.prepare(`UPDATE users SET matches_played_today = 0, extra_plays = 0, last_match_date = ? WHERE tg_id = ?`).run(todayStr(), tgId);
  }
  return getUser(tgId);
}
export function getPlaysRemaining(tgId, dailyLimit) {
  const user = ensureDailyReset(tgId);
  const total = dailyLimit + user.extra_plays;
  return Math.max(0, total - user.matches_played_today);
}
export function addExtraPlays(tgId, count) {
  ensureDailyReset(tgId);
  db.prepare('UPDATE users SET extra_plays = extra_plays + ? WHERE tg_id = ?').run(count, tgId);
}
function incrementPlaysUsed(tgId) {
  db.prepare('UPDATE users SET matches_played_today = matches_played_today + 1 WHERE tg_id = ?').run(tgId);
}

// ---- matchmaking (async: whoever joins second instantly resolves the match) ----
function resolveCardSnapshot(userCardIds) {
  if (!userCardIds || !userCardIds.length) return [];
  const rows = db.prepare(`
    SELECT uc.level, uc.bonus_power, c.name, c.power, c.power_per_level, c.image_url
    FROM user_cards uc JOIN game_cards c ON c.id = uc.card_id
    WHERE uc.id IN (${userCardIds.map(() => '?').join(',')})
  `).all(...userCardIds);
  return rows.map(r => ({ name: r.name, image_url: r.image_url, level: r.level, power: effectivePower(r, r.level, r.bonus_power) }));
}

export function joinQueue(tgId, userCardIds, minDeckSize, maxDeckSize) {
  if (!Array.isArray(userCardIds) || userCardIds.length < minDeckSize) {
    throw new Error(`حداقل ${minDeckSize} کارت باید انتخاب کنی`);
  }
  if (userCardIds.length > maxDeckSize) {
    throw new Error(`حداکثر ${maxDeckSize} کارت می‌تونی انتخاب کنی`);
  }
  const owned = db.prepare(`SELECT id, card_id, level, bonus_power FROM user_cards WHERE tg_id = ? AND id IN (${userCardIds.map(() => '?').join(',')})`)
    .all(tgId, ...userCardIds);
  if (owned.length !== userCardIds.length) throw new Error('یکی از کارت‌ها مال تو نیست');

  const power = owned.reduce((sum, uc) => {
    const card = getGameCard(uc.card_id);
    return sum + (card ? effectivePower(card, uc.level, uc.bonus_power) : 0);
  }, 0);

  // پاک کردن صف‌های منقضی‌شده (بیشتر از ۵ دقیقه)
  db.prepare(`UPDATE game_queue SET status = 'expired' WHERE status = 'waiting' AND created_at < datetime('now','-5 minutes')`).run();

  const opponent = db.prepare(`SELECT * FROM game_queue WHERE status = 'waiting' AND tg_id != ? ORDER BY created_at ASC LIMIT 1`).get(tgId);

  if (opponent) {
    // مچ فوری — قدرت دقیقاً همون مجموع قدرت کارت‌های انتخابیه، بدون هیچ شانس یا رندومی
    const myPower = power;
    const oppPower = opponent.power;
    const winnerTgId = myPower >= oppPower ? tgId : opponent.tg_id; // مساوی: نفری که دیرتر join کرده (تازه‌وارد) می‌بره

    const myCards = JSON.stringify(resolveCardSnapshot(userCardIds));
    const oppCards = JSON.stringify(resolveCardSnapshot(JSON.parse(opponent.card_ids)));

    db.prepare(`UPDATE game_queue SET status = 'matched' WHERE id = ?`).run(opponent.id);
    const info = db.prepare(`
      INSERT INTO game_matches (player1_tg_id, player2_tg_id, player1_power, player2_power, winner_tg_id, player1_cards, player2_cards)
      VALUES (?,?,?,?,?,?,?)
    `).run(opponent.tg_id, tgId, oppPower, myPower, winnerTgId, oppCards, myCards);

    bumpScore(opponent.tg_id, opponent.tg_id === winnerTgId);
    bumpScore(tgId, tgId === winnerTgId);
    incrementPlaysUsed(opponent.tg_id);
    incrementPlaysUsed(tgId);

    return {
      matched: true, matchId: info.lastInsertRowid,
      won: tgId === winnerTgId, myPower, oppPower, opponentTgId: opponent.tg_id,
    };
  }

  const info = db.prepare(`INSERT INTO game_queue (tg_id, card_ids, power) VALUES (?,?,?)`)
    .run(tgId, JSON.stringify(userCardIds), power);
  return { matched: false, queueId: info.lastInsertRowid };
}
export function getQueueStatus(tgId) {
  const row = db.prepare(`SELECT * FROM game_queue WHERE tg_id = ? ORDER BY created_at DESC LIMIT 1`).get(tgId);
  if (!row) return { inQueue: false };
  if (row.status === 'waiting') {
    const expired = new Date(row.created_at + 'Z').getTime() + 5 * 60 * 1000 < Date.now();
    if (expired) {
      db.prepare(`UPDATE game_queue SET status = 'expired' WHERE id = ?`).run(row.id);
      return { inQueue: false, expired: true };
    }
    return { inQueue: true };
  }
  if (row.status === 'matched') {
    // آخرین مسابقه‌ای که این کاربر توش شرکت داشته — بعد از نمایش یک‌بار، وضعیت رو seen می‌کنیم
    // تا کاربر گیر نکنه و بتونه دوباره وارد نبرد جدید بشه (باگ قبلی همینجا بود)
    const match = db.prepare(`SELECT * FROM game_matches WHERE player1_tg_id = ? OR player2_tg_id = ? ORDER BY created_at DESC LIMIT 1`).get(tgId, tgId);
    db.prepare(`UPDATE game_queue SET status = 'seen' WHERE id = ?`).run(row.id);
    if (match) {
      const iAmP1 = match.player1_tg_id === Number(tgId);
      return {
        inQueue: false, justMatched: true,
        won: match.winner_tg_id === Number(tgId),
        myPower: iAmP1 ? match.player1_power : match.player2_power,
        oppPower: iAmP1 ? match.player2_power : match.player1_power,
      };
    }
  }
  return { inQueue: false };
}
export function cancelQueue(tgId) {
  db.prepare(`UPDATE game_queue SET status = 'cancelled' WHERE tg_id = ? AND status = 'waiting'`).run(tgId);
}

// ---- scores / leaderboard ----
function bumpScore(tgId, won) {
  db.prepare(`INSERT INTO game_scores (tg_id, points, wins, losses) VALUES (?,?,?,?)
    ON CONFLICT(tg_id) DO UPDATE SET points = points + excluded.points, wins = wins + excluded.wins, losses = losses + excluded.losses`)
    .run(tgId, won ? 3 : 1, won ? 1 : 0, won ? 0 : 1);
}
export function getLeaderboard(limit = 50) {
  return db.prepare(`
    SELECT s.*, u.username, u.first_name FROM game_scores s
    JOIN users u ON u.tg_id = s.tg_id
    ORDER BY s.points DESC LIMIT ?
  `).all(limit);
}
export function getMyRank(tgId) {
  const row = db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM game_scores
    WHERE points > (SELECT points FROM game_scores WHERE tg_id = ?)
  `).get(tgId);
  return row.rank;
}

// ---- match history ----
export function getMatchHistory(tgId, limit = 30) {
  const rows = db.prepare(`
    SELECT m.*, u1.username AS p1_username, u1.first_name AS p1_first_name,
           u2.username AS p2_username, u2.first_name AS p2_first_name
    FROM game_matches m
    JOIN users u1 ON u1.tg_id = m.player1_tg_id
    JOIN users u2 ON u2.tg_id = m.player2_tg_id
    WHERE m.player1_tg_id = ? OR m.player2_tg_id = ?
    ORDER BY m.created_at DESC LIMIT ?
  `).all(tgId, tgId, limit);
  return rows.map(m => {
    const iAmP1 = m.player1_tg_id === Number(tgId);
    return {
      id: m.id, created_at: m.created_at,
      won: m.winner_tg_id === Number(tgId),
      myPower: iAmP1 ? m.player1_power : m.player2_power,
      oppPower: iAmP1 ? m.player2_power : m.player1_power,
      opponentName: iAmP1 ? (m.p2_first_name || 'کاربر') : (m.p1_first_name || 'کاربر'),
      opponentUsername: iAmP1 ? m.p2_username : m.p1_username,
      myCards: JSON.parse((iAmP1 ? m.player1_cards : m.player2_cards) || '[]'),
      oppCards: JSON.parse((iAmP1 ? m.player2_cards : m.player1_cards) || '[]'),
    };
  });
}

// ---- leaderboard settings / reset ----
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM game_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO game_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}
export function getLeaderboardResetInfo() {
  const intervalDays = Number(getSetting('lb_reset_interval_days', 7));
  let lastReset = getSetting('lb_last_reset', null);
  if (!lastReset) {
    lastReset = new Date().toISOString();
    setSetting('lb_last_reset', lastReset);
  }
  const nextReset = new Date(lastReset).getTime() + intervalDays * 24 * 60 * 60 * 1000;
  return { intervalDays, lastReset, nextReset };
}
export function checkAndAutoResetLeaderboard() {
  const { nextReset, intervalDays } = getLeaderboardResetInfo();
  if (Date.now() >= nextReset) {
    resetLeaderboard();
    setSetting('lb_reset_interval_days', intervalDays); // حفظ همون فاصله برای دور بعد
  }
}
export function resetLeaderboard() {
  db.prepare('DELETE FROM game_scores').run();
  setSetting('lb_last_reset', new Date().toISOString());
}
export function setLeaderboardResetInterval(days) {
  setSetting('lb_reset_interval_days', days);
}

// ---- تنظیمات کلی بازی (قابل مدیریت از پنل) ----
export function getGameConfig() {
  return {
    minCardPower: Number(getSetting('min_card_power', 1)),
    maxCardPower: Number(getSetting('max_card_power', 100)),
    minDeckSize: Number(getSetting('min_deck_size', 1)),
    maxDeckSize: Number(getSetting('max_deck_size', 5)),
  };
}
export function setGameConfig(fields) {
  if (fields.minCardPower !== undefined) setSetting('min_card_power', fields.minCardPower);
  if (fields.maxCardPower !== undefined) setSetting('max_card_power', fields.maxCardPower);
  if (fields.minDeckSize !== undefined) setSetting('min_deck_size', fields.minDeckSize);
  if (fields.maxDeckSize !== undefined) setSetting('max_deck_size', fields.maxDeckSize);
}

export function listLeaderboardPrizes() {
  return db.prepare('SELECT * FROM leaderboard_prizes ORDER BY rank_from').all();
}
export function addLeaderboardPrize(rankFrom, rankTo, text) {
  db.prepare('INSERT INTO leaderboard_prizes (rank_from, rank_to, prize_text) VALUES (?,?,?)').run(rankFrom, rankTo, text);
}
export function deleteLeaderboardPrize(id) {
  db.prepare('DELETE FROM leaderboard_prizes WHERE id = ?').run(id);
}

/* ===================== GIFT MARKET (P2P, escrow-based — مثل پرتال) =====================
   کاربر گیفت واقعی خودش رو (که تو تلگرام داره) اینجا لیست می‌کنه.
   پول خریدار موقع خرید بلوکه می‌شه (امانت)، فروشنده گیفت رو دستی تو تلگرام می‌فرسته،
   خریدار دریافتش رو تایید می‌کنه و تازه اونوقت پول (منهای کارمزد) آزاد می‌شه.
   ================================================================================== */
export function createListing(sellerTgId, title, imageUrl, category, price, currencyCode) {
  const info = db.prepare(`INSERT INTO gift_listings (seller_tg_id, title, image_url, category, price_rial, currency_code) VALUES (?,?,?,?,?,?)`)
    .run(sellerTgId, title, imageUrl || null, category || null, price, currencyCode || 'RIAL');
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
function creditCurrency(tgId, code, amount, reason, refId) {
  if (code === 'RIAL') adjustBalance(tgId, 'rial', amount, reason, refId);
  else adjustCurrencyBalance(tgId, code, amount);
}
function debitCheck(tgId, code, amount) {
  if (code === 'RIAL') return getUser(tgId).balance_rial >= amount;
  return getCurrencyBalance(tgId, code) >= amount;
}

export function reserveListing(buyerTgId, id) {
  const g = getListing(id);
  if (!g) throw new Error('آگهی پیدا نشد');
  if (g.status !== 'listed') throw new Error('این گیفت دیگه در دسترس نیست');
  if (g.seller_tg_id === Number(buyerTgId)) throw new Error('نمی‌تونی گیفت خودتو بخری');
  if (!debitCheck(buyerTgId, g.currency_code, g.price_rial)) throw new Error(`موجودی ${g.currency_code === 'RIAL' ? 'کیف‌پول' : g.currency_code} کافی نیست`);

  creditCurrency(buyerTgId, g.currency_code, -g.price_rial, `پرداخت امانی برای گیفت «${g.title}»`, String(id));
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
  creditCurrency(g.seller_tg_id, g.currency_code, sellerReceives, `فروش گیفت «${g.title}» در بازار کاربران`, String(id));
  db.prepare(`UPDATE gift_listings SET status='completed', completed_at=datetime('now') WHERE id=?`).run(id);
  return { ...g, sellerReceives };
}
// ادمین برای حل اختلاف: یا پول رو به فروشنده آزاد می‌کنه یا به خریدار برمی‌گردونه
export function adminResolveListing(id, action, feePercent) {
  const g = getListing(id);
  if (!g || g.status !== 'reserved') throw new Error('قابل رسیدگی نیست');
  if (action === 'release') {
    const fee = Math.floor(g.escrow_amount * (feePercent / 100));
    creditCurrency(g.seller_tg_id, g.currency_code, g.escrow_amount - fee, `آزادسازی امانت توسط ادمین — گیفت «${g.title}»`, String(id));
    db.prepare(`UPDATE gift_listings SET status='completed', completed_at=datetime('now') WHERE id=?`).run(id);
  } else if (action === 'refund') {
    creditCurrency(g.buyer_tg_id, g.currency_code, g.escrow_amount, `بازگشت وجه توسط ادمین — گیفت «${g.title}»`, String(id));
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

/* ===================== MULTI-CURRENCY WALLET (TON, USDT, هر ارز دیگه) ===================== */
export function listCurrencies(activeOnly = true) {
  return activeOnly
    ? db.prepare('SELECT * FROM currencies WHERE active = 1').all()
    : db.prepare('SELECT * FROM currencies').all();
}
export function addCurrency(code, name, icon, address, note, minAmount) {
  db.prepare(`INSERT INTO currencies (code, name, icon, deposit_address, deposit_note, min_amount) VALUES (?,?,?,?,?,?)`)
    .run(code.toUpperCase(), name, icon || '💰', address || null, note || null, minAmount || 0);
}
export function updateCurrency(code, fields) {
  const c = db.prepare('SELECT * FROM currencies WHERE code = ?').get(code);
  if (!c) throw new Error('ارز پیدا نشد');
  db.prepare(`UPDATE currencies SET name=?, icon=?, deposit_address=?, deposit_note=?, min_amount=?, active=? WHERE code=?`)
    .run(fields.name ?? c.name, fields.icon ?? c.icon, fields.deposit_address ?? c.deposit_address,
         fields.deposit_note ?? c.deposit_note, fields.min_amount ?? c.min_amount, fields.active ?? c.active, code);
}
export function deleteCurrency(code) {
  db.prepare('DELETE FROM currencies WHERE code = ?').run(code);
}
export function getUserBalances(tgId) {
  return db.prepare(`
    SELECT c.code, c.name, c.icon, COALESCE(b.amount, 0) AS amount
    FROM currencies c
    LEFT JOIN user_balances b ON b.currency_code = c.code AND b.tg_id = ?
    WHERE c.active = 1
  `).all(tgId);
}
export function adjustCurrencyBalance(tgId, code, delta) {
  db.prepare(`INSERT INTO user_balances (tg_id, currency_code, amount) VALUES (?,?,?)
    ON CONFLICT(tg_id, currency_code) DO UPDATE SET amount = amount + excluded.amount`)
    .run(tgId, code, delta);
}
export function getCurrencyBalance(tgId, code) {
  const row = db.prepare('SELECT amount FROM user_balances WHERE tg_id = ? AND currency_code = ?').get(tgId, code);
  return row ? row.amount : 0;
}
export function createCurrencyRequest(tgId, code, type, amount, address, txHash) {
  const info = db.prepare(`INSERT INTO currency_requests (tg_id, currency_code, type, amount, address, tx_hash) VALUES (?,?,?,?,?,?)`)
    .run(tgId, code, type, amount, address || null, txHash || null);
  return info.lastInsertRowid;
}
export function getCurrencyRequest(id) {
  return db.prepare('SELECT * FROM currency_requests WHERE id = ?').get(id);
}
export function setCurrencyRequestStatus(id, status) {
  db.prepare('UPDATE currency_requests SET status = ? WHERE id = ?').run(status, id);
}
export function getAllCurrencyRequestsForAdmin() {
  return db.prepare(`
    SELECT r.*, u.username, u.first_name FROM currency_requests r
    JOIN users u ON u.tg_id = r.tg_id
    ORDER BY r.created_at DESC LIMIT 200
  `).all();
}

/* ===================== CARD TASKS (separate from general bot tasks) ===================== */
export function listActiveCardTasks() {
  return db.prepare(`
    SELECT ct.*, gc.name AS card_name, gc.image_url AS card_image, gc.power AS card_power
    FROM card_tasks ct JOIN game_cards gc ON gc.id = ct.reward_card_id
    WHERE ct.active = 1 ORDER BY ct.created_at
  `).all();
}
export function isCardTaskDone(tgId, taskId) {
  return !!db.prepare('SELECT 1 FROM card_task_completions WHERE tg_id = ? AND task_id = ?').get(tgId, taskId);
}
export function completeCardTask(tgId, task) {
  db.prepare('INSERT OR IGNORE INTO card_task_completions (tg_id, task_id) VALUES (?,?)').run(tgId, task.id);
  grantCard(tgId, task.reward_card_id);
}
export function listAllCardTasksForAdmin() {
  return db.prepare(`
    SELECT ct.*, (SELECT COUNT(*) FROM card_task_completions c WHERE c.task_id = ct.id) AS completions
    FROM card_tasks ct ORDER BY ct.created_at DESC
  `).all();
}
export function addCardTask(id, title, description, type, channelUsername, link, rewardCardId) {
  db.prepare(`INSERT INTO card_tasks (id, title, description, type, channel_username, link, reward_card_id) VALUES (?,?,?,?,?,?,?)`)
    .run(id, title, description || '', type, channelUsername || null, link || null, rewardCardId);
}
export function updateCardTask(id, fields) {
  const t = db.prepare('SELECT * FROM card_tasks WHERE id = ?').get(id);
  if (!t) throw new Error('تسک پیدا نشد');
  db.prepare(`UPDATE card_tasks SET title=?, description=?, type=?, channel_username=?, link=?, reward_card_id=?, active=? WHERE id=?`)
    .run(fields.title ?? t.title, fields.description ?? t.description, fields.type ?? t.type,
         fields.channel_username ?? t.channel_username, fields.link ?? t.link,
         fields.reward_card_id ?? t.reward_card_id, fields.active ?? t.active, id);
}
export function deleteCardTask(id) {
  db.prepare('DELETE FROM card_tasks WHERE id = ?').run(id);
}

/* ===================== BAN / RESTRICT USERS ===================== */
export function banUser(tgId, reason) {
  db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE tg_id = ?').run(reason || 'بدون دلیل مشخص', tgId);
}
export function unbanUser(tgId) {
  db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE tg_id = ?').run(tgId);
}
export function isBanned(tgId) {
  const u = db.prepare('SELECT banned, ban_reason FROM users WHERE tg_id = ?').get(tgId);
  return u ? { banned: !!u.banned, reason: u.ban_reason } : { banned: false };
}

/* ===================== SUPPORT TICKETS ===================== */
export function getOrCreateOpenTicket(tgId) {
  let t = db.prepare(`SELECT * FROM support_tickets WHERE tg_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).get(tgId);
  if (!t) {
    const info = db.prepare(`INSERT INTO support_tickets (tg_id) VALUES (?)`).run(tgId);
    t = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(info.lastInsertRowid);
  }
  return t;
}
export function addSupportMessage(ticketId, sender, text, imageUrl) {
  db.prepare(`INSERT INTO support_messages (ticket_id, sender, text, image_url) VALUES (?,?,?,?)`).run(ticketId, sender, text || null, imageUrl || null);
  db.prepare(`UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?`).run(ticketId);
}
export function getTicketMessages(ticketId) {
  return db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId);
}
export function getMyTickets(tgId) {
  return db.prepare('SELECT * FROM support_tickets WHERE tg_id = ? ORDER BY created_at DESC').all(tgId);
}
export function getAllTicketsForAdmin() {
  return db.prepare(`
    SELECT t.*, u.username, u.first_name,
      (SELECT text FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM support_tickets t JOIN users u ON u.tg_id = t.tg_id
    ORDER BY t.updated_at DESC
  `).all();
}
export function getTicket(id) {
  return db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
}
export function closeTicket(id) {
  db.prepare(`UPDATE support_tickets SET status = 'closed' WHERE id = ?`).run(id);
}

/* ===================== BROADCAST ===================== */
export function getAllUserIds() {
  return db.prepare('SELECT tg_id FROM users').all().map(r => r.tg_id);
}
