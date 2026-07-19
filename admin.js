import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import db, {
  adjustBalance, getAllListingsForAdmin, adminResolveListing,
  listGiftCategories, addGiftCategory, deleteGiftCategory,
  listCurrencies, updateCurrency,
  adjustCurrencyBalance, getAllCurrencyRequestsForAdmin,
  listGameCards, addGameCard, updateGameCard, deleteGameCard,
  getLeaderboard, listLeaderboardPrizes, addLeaderboardPrize, deleteLeaderboardPrize,
  getLeaderboardResetInfo, resetLeaderboard, setLeaderboardResetInterval,
  listAllCardTasksForAdmin, addCardTask, updateCardTask, deleteCardTask,
} from './db.js';
import { getLivePrices } from './prices.js';
import { sendMessage } from './telegram.js';

const router = express.Router();
const GIFT_MARKET_FEE = Number(process.env.GIFT_MARKET_FEE_PERCENT || 5);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|png|webp|gif)/.test(file.mimetype)),
});

/* =========================================================================
   AUTH — simple password login, in-memory session tokens.
   For a single admin panel used by a small team this is enough; for a
   bigger team, swap this for real accounts + hashed passwords per admin.
   ========================================================================= */
const sessions = new Map(); // token -> expiryTimestamp
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function requireAdminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) return res.status(401).json({ error: 'unauthorized' });
  sessions.set(token, Date.now() + TOKEN_TTL_MS); // sliding expiry
  next();
}

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PANEL_PASSWORD تنظیم نشده' });
  }
  if (password !== process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(401).json({ error: 'رمز عبور اشتباه است' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + TOKEN_TTL_MS);
  res.json({ token });
});

router.post('/logout', requireAdminAuth, (req, res) => {
  const token = req.headers.authorization.slice(7);
  sessions.delete(token);
  res.json({ ok: true });
});

router.use(requireAdminAuth); // همه مسیرهای زیر نیاز به لاگین دارن

// آپلود واقعی عکس (نه لینک) — برای تصویر محصولات
router.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل عکس ارسال نشد' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

/* =========================================================================
   GIFT CATEGORIES — دسته‌بندی‌های بازار گیفت
   ========================================================================= */
router.get('/gift-categories', (req, res) => {
  res.json(listGiftCategories());
});
router.post('/gift-categories', (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'نام دسته‌بندی الزامی است' });
  try { addGiftCategory(name, icon); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: 'این دسته‌بندی قبلاً ثبت شده' }); }
});
router.delete('/gift-categories/:id', (req, res) => {
  deleteGiftCategory(req.params.id);
  res.json({ ok: true });
});

/* =========================================================================
   DASHBOARD / STATS
   ========================================================================= */
router.get('/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const orders = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const rialIn = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='in' AND currency='rial'`).get().s;
  const rialOut = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='out' AND currency='rial'`).get().s;
  const starsIn = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='in' AND currency='stars'`).get().s;
  const todayOrders = db.prepare(`SELECT COUNT(*) c FROM orders WHERE date(created_at) = date('now')`).get().c;
  const revenueByDay = db.prepare(`
    SELECT date(created_at) d, COALESCE(SUM(amount_rial),0) total
    FROM orders WHERE created_at >= datetime('now','-14 day')
    GROUP BY d ORDER BY d ASC
  `).all();
  const topProducts = db.prepare(`
    SELECT product_id, COUNT(*) sales, COALESCE(SUM(amount_rial),0) revenue
    FROM orders GROUP BY product_id ORDER BY revenue DESC LIMIT 5
  `).all();
  res.json({ users, orders, todayOrders, rialIn, rialOut, starsIn, revenueByDay, topProducts });
});

/* =========================================================================
   USERS
   ========================================================================= */
router.get('/users', (req, res) => {
  const { q = '', limit = 50, offset = 0 } = req.query;
  const rows = db.prepare(`
    SELECT * FROM users
    WHERE CAST(tg_id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(`%${q}%`, `%${q}%`, `%${q}%`, Number(limit), Number(offset));
  const total = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  res.json({ rows, total });
});

router.get('/users/:tgId', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(req.params.tgId);
  if (!user) return res.status(404).json({ error: 'not found' });
  const orders = db.prepare('SELECT * FROM orders WHERE tg_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.tgId);
  const transactions = db.prepare('SELECT * FROM transactions WHERE tg_id = ? ORDER BY created_at DESC LIMIT 30').all(req.params.tgId);
  const referrals = db.prepare('SELECT tg_id, username, first_name, created_at FROM users WHERE referred_by = ?').all(req.params.tgId);
  res.json({ user, orders, transactions, referrals });
});

// شارژ یا کسر دستی موجودی (مثبت = شارژ، منفی = کسر)
router.post('/users/:tgId/adjust-balance', (req, res) => {
  const { currency, amount, reason } = req.body; // currency: 'rial' | 'stars'
  if (!['rial', 'stars'].includes(currency) || !Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'ورودی نامعتبر' });
  }
  const tgId = Number(req.params.tgId);
  adjustBalance(tgId, currency, amount, reason || 'اصلاح دستی توسط ادمین');
  const label = currency === 'stars' ? `${amount}⭐️` : `${amount.toLocaleString()} تومان`;
  sendMessage(tgId, `💰 موجودی شما ${amount > 0 ? 'افزایش' : 'کاهش'} یافت: ${label}\nدلیل: ${reason || 'اصلاح توسط پشتیبانی'}`).catch(() => {});
  res.json({ ok: true, user: db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId) });
});

/* =========================================================================
   ORDERS
   ========================================================================= */
router.get('/orders', (req, res) => {
  const { status = '', limit = 50, offset = 0 } = req.query;
  const rows = status
    ? db.prepare(`SELECT o.*, u.username, u.first_name FROM orders o JOIN users u ON u.tg_id=o.tg_id WHERE o.status=? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(status, Number(limit), Number(offset))
    : db.prepare(`SELECT o.*, u.username, u.first_name FROM orders o JOIN users u ON u.tg_id=o.tg_id ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(Number(limit), Number(offset));
  const total = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  res.json({ rows, total });
});

router.patch('/orders/:id', (req, res) => {
  const { status } = req.body; // pending | paid | delivered | failed
  if (!['pending', 'paid', 'delivered', 'failed'].includes(status)) return res.status(400).json({ error: 'وضعیت نامعتبر' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (status === 'delivered') {
    sendMessage(order.tg_id, `📦 سفارش شما (#${order.id}) تحویل داده شد.`).catch(() => {});
  }
  res.json({ ok: true, order });
});

/* =========================================================================
   PRODUCTS
   ========================================================================= */
router.get('/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY category, name').all());
});

router.post('/products', (req, res) => {
  const { id, category, name, description, price_rial, image_url } = req.body;
  if (!id || !category || !name || !price_rial) return res.status(400).json({ error: 'فیلدهای ضروری خالی است' });
  db.prepare('INSERT INTO products (id, category, name, description, price_rial, image_url) VALUES (?,?,?,?,?,?)')
    .run(id, category, name, description || '', price_rial, image_url || null);
  res.json({ ok: true });
});

router.patch('/products/:id', (req, res) => {
  const { name, description, price_rial, category, active, image_url } = req.body;
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE products SET name=?, description=?, price_rial=?, category=?, active=?, image_url=? WHERE id=?`)
    .run(name ?? p.name, description ?? p.description, price_rial ?? p.price_rial, category ?? p.category, active ?? p.active, image_url ?? p.image_url, req.params.id);
  res.json({ ok: true });
});

router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* =========================================================================
   TRANSACTIONS
   ========================================================================= */
router.get('/transactions', (req, res) => {
  const { limit = 80, offset = 0 } = req.query;
  const rows = db.prepare(`
    SELECT t.*, u.username, u.first_name FROM transactions t
    JOIN users u ON u.tg_id = t.tg_id
    ORDER BY t.created_at DESC LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset));
  res.json(rows);
});

/* =========================================================================
   REFERRALS — top referrers by number of invites and commission paid
   ========================================================================= */
router.get('/referrals', (req, res) => {
  const rows = db.prepare(`
    SELECT u.tg_id, u.username, u.first_name,
      (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.tg_id) AS invited_count,
      COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.tg_id = u.tg_id AND t.reason LIKE 'پورسانت%'),0) AS commission_earned
    FROM users u
    WHERE invited_count > 0
    ORDER BY commission_earned DESC LIMIT 50
  `).all();
  res.json(rows);
});

/* =========================================================================
   TASKS — مدیریت تسک‌ها (اضافه/ویرایش/حذف) از پنل ادمین
   ========================================================================= */
router.get('/tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM task_completions c WHERE c.task_id = t.id) AS completions
    FROM tasks t ORDER BY t.created_at DESC
  `).all();
  res.json(rows);
});
router.post('/tasks', (req, res) => {
  const { id, title, description, type, channel_username, link, reward_rial, reward_stars, reward_card_id } = req.body;
  if (!id || !title || !type) return res.status(400).json({ error: 'فیلدهای ضروری خالی است' });
  db.prepare(`INSERT INTO tasks (id, title, description, type, channel_username, link, reward_rial, reward_stars, reward_card_id) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, title, description || '', type, channel_username || null, link || null, reward_rial || 0, reward_stars || 0, reward_card_id || null);
  res.json({ ok: true });
});
router.patch('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  db.prepare(`UPDATE tasks SET title=?, description=?, type=?, channel_username=?, link=?, reward_rial=?, reward_stars=?, reward_card_id=?, active=? WHERE id=?`)
    .run(b.title ?? t.title, b.description ?? t.description, b.type ?? t.type, b.channel_username ?? t.channel_username,
         b.link ?? t.link, b.reward_rial ?? t.reward_rial, b.reward_stars ?? t.reward_stars, b.reward_card_id ?? t.reward_card_id, b.active ?? t.active, req.params.id);
  res.json({ ok: true });
});
router.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* =========================================================================
   GIFT MARKET — نظارت و حل اختلاف امانت‌ها
   ========================================================================= */
router.get('/gift-listings', (req, res) => {
  res.json(getAllListingsForAdmin());
});
router.post('/gift-listings/:id/resolve', (req, res) => {
  const { action } = req.body; // release | refund
  try {
    const g = adminResolveListing(req.params.id, action, GIFT_MARKET_FEE);
    const msg = action === 'release'
      ? `✅ ادمین معامله گیفت «${g.title}» رو تایید کرد و پول به فروشنده واریز شد.`
      : `↩️ ادمین معامله گیفت «${g.title}» رو لغو کرد و پول به کیف‌پولت برگشت.`;
    sendMessage(action === 'release' ? g.seller_tg_id : g.buyer_tg_id, msg).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* =========================================================================
   CURRENCIES — فقط تتر و تون (ثابت، دیگه نمی‌شه ارز جدید اضافه/حذف کرد)
   ========================================================================= */
router.get('/currencies', (req, res) => {
  res.json(listCurrencies(false));
});
router.patch('/currencies/:code', (req, res) => {
  try { updateCurrency(req.params.code, req.body); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/prices', async (req, res) => {
  res.json(await getLivePrices());
});

// تاریخچه‌ی همه‌ی درخواست‌های واریز/برداشت ارزی (برای نظارت — تایید اصلی از داخل ربات انجام می‌شه)
router.get('/currency-requests', (req, res) => {
  res.json(getAllCurrencyRequestsForAdmin());
});

/* =========================================================================
   CARD GAME — کارت‌ها، لیدربورد و جایزه‌ها
   ========================================================================= */
router.get('/game-cards', (req, res) => {
  res.json(listGameCards(false));
});
router.post('/game-cards', (req, res) => {
  const { id, name, image_url, power, description, currency_code, price, upgrade_cost, upgrade_currency, max_level, power_per_level } = req.body;
  if (!id || !name || !currency_code) return res.status(400).json({ error: 'شناسه، نام و ارز الزامیه' });
  try {
    addGameCard(id, name, image_url, Number(power) || 10, description, currency_code, Number(price) || 0,
      Number(upgrade_cost) || 0, upgrade_currency || 'RIAL', Number(max_level) || 5, Number(power_per_level) || 5);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'این شناسه قبلاً استفاده شده' }); }
});
router.patch('/game-cards/:id', (req, res) => {
  try { updateGameCard(req.params.id, req.body); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/game-cards/:id', (req, res) => {
  deleteGameCard(req.params.id);
  res.json({ ok: true });
});

router.get('/game-leaderboard', (req, res) => {
  res.json(getLeaderboard(100));
});

router.get('/leaderboard-prizes', (req, res) => {
  res.json(listLeaderboardPrizes());
});
router.post('/leaderboard-prizes', (req, res) => {
  const { rank_from, rank_to, prize_text } = req.body;
  if (!rank_from || !rank_to || !prize_text) return res.status(400).json({ error: 'همه فیلدها الزامیه' });
  addLeaderboardPrize(Number(rank_from), Number(rank_to), prize_text);
  res.json({ ok: true });
});
router.delete('/leaderboard-prizes/:id', (req, res) => {
  deleteLeaderboardPrize(req.params.id);
  res.json({ ok: true });
});

router.get('/leaderboard-reset-info', (req, res) => {
  res.json(getLeaderboardResetInfo());
});
router.post('/leaderboard-reset-info', (req, res) => {
  const days = Number(req.body.intervalDays);
  if (!days || days < 1) return res.status(400).json({ error: 'عدد نامعتبر' });
  setLeaderboardResetInterval(days);
  res.json({ ok: true });
});
router.post('/leaderboard-reset-now', (req, res) => {
  resetLeaderboard();
  res.json({ ok: true });
});

/* =========================================================================
   CARD TASKS — تسک‌های مجزای گرفتن کارت رایگان
   ========================================================================= */
router.get('/card-tasks', (req, res) => {
  res.json(listAllCardTasksForAdmin());
});
router.post('/card-tasks', (req, res) => {
  const { id, title, description, type, channel_username, link, reward_card_id } = req.body;
  if (!id || !title || !type || !reward_card_id) return res.status(400).json({ error: 'فیلدهای ضروری خالی است' });
  try { addCardTask(id, title, description, type, channel_username, link, reward_card_id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: 'این شناسه قبلاً استفاده شده' }); }
});
router.patch('/card-tasks/:id', (req, res) => {
  try { updateCardTask(req.params.id, req.body); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/card-tasks/:id', (req, res) => {
  deleteCardTask(req.params.id);
  res.json({ ok: true });
});

export default router;
