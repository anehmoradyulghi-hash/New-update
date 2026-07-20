import Database from 'better-sqlite3';

// مسیر دیتابیس را اگر لازم داری عوض کن
const db = new Database('./data.sqlite');

// Performance / reliability
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
  last_spin_at TEXT,
  matches_played_today INTEGER NOT NULL DEFAULT 0,
  extra_plays INTEGER NOT NULL DEFAULT 0,
  last_match_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'link',
  channel_username TEXT,
  link TEXT,
  reward_rial INTEGER NOT NULL DEFAULT 0,
  reward_stars INTEGER NOT NULL DEFAULT 0,
  reward_card_id TEXT,
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
  status TEXT NOT NULL DEFAULT 'listed',
  buyer_tg_id INTEGER,
  escrow_amount INTEGER,
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
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '💰',
  deposit_address TEXT,
  deposit_note TEXT,
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
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  address TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  power INTEGER NOT NULL DEFAULT 10,
  description TEXT,
  currency_code TEXT NOT NULL DEFAULT 'RIAL',
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  upgrade_cost REAL NOT NULL DEFAULT 0,
  upgrade_currency TEXT NOT NULL DEFAULT 'RIAL',
  max_level INTEGER NOT NULL DEFAULT 5,
  power_per_level INTEGER NOT NULL DEFAULT 5,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  bonus_power INTEGER NOT NULL DEFAULT 0,
  acquired_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  card_ids TEXT NOT NULL,
  power INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
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
  type TEXT NOT NULL DEFAULT 'link',
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
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price_rial INTEGER NOT NULL,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  amount_rial INTEGER NOT NULL,
  pay_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gateway_payments (
  authority TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  amount_rial INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ===================== SAFE MIGRATIONS =====================
function tryAddColumn(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    // column already exists یا migration قبلاً انجام شده
  }
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

// ===================== HELPERS =====================
export function getUser(tgId) {
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
}

export function upsertUser({ tg_id, username = null, first_name = null, ref_code = null, referred_by = null }) {
  db.prepare(`
    INSERT INTO users (tg_id, username, first_name, ref_code, referred_by)
    VALUES (@tg_id, @username, @first_name, @ref_code, @referred_by)
    ON CONFLICT(tg_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
  `).run({ tg_id, username, first_name, ref_code, referred_by });
}

export function addTransaction({ tg_id, type, currency, amount, reason, ref_id = null }) {
  return db.prepare(`
    INSERT INTO transactions (tg_id, type, currency, amount, reason, ref_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tg_id, type, currency, amount, reason, ref_id);
}

export function createGatewayPayment({ authority, tg_id, purpose, amount_rial }) {
  return db.prepare(`
    INSERT INTO gateway_payments (authority, tg_id, purpose, amount_rial)
    VALUES (?, ?, ?, ?)
  `).run(authority, tg_id, purpose, amount_rial);
}

export function getGatewayPayment(authority) {
  return db.prepare(`SELECT * FROM gateway_payments WHERE authority = ?`).get(authority);
}

export function markGatewayPaymentPaid(authority) {
  return db.prepare(`
    UPDATE gateway_payments
    SET status = 'paid'
    WHERE authority = ?
  `).run(authority);
}

export default db;
