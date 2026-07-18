import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import {
  sendMessage, answerPreCheckoutQuery, answerCallbackQuery, createStarsInvoiceLink,
  setWebhook, validateInitData, isChannelMember, getMe,
} from './telegram.js';
import { requestPayment, verifyPayment } from './gateway.js';
import db, {
  getOrCreateUser, getUser, adjustBalance, payReferralCommission,
  createOrder, getProduct,
  settleStake, pendingStakeReward, stakeDeposit, stakeWithdraw,
  listActiveTasks, isTaskDone, completeTask,
  createListing, getListing, getMarketListings, getMyListings, cancelListing, reserveListing, confirmReceived,
  listGiftCategories,
  createManualPayment, getManualPayment, setManualPaymentStatus,
  listCurrencies, getUserBalances, adjustCurrencyBalance, getCurrencyBalance,
  createCurrencyRequest, getCurrencyRequest, setCurrencyRequestStatus,
  listGameCards, getGameCard, buyGameCard, getUserCards, upgradeUserCard,
  getPlaysRemaining, addExtraPlays, joinQueue, getQueueStatus, cancelQueue,
  getLeaderboard, getMyRank, listLeaderboardPrizes,
} from './db.js';
import adminRouter from './admin.js';

const app = express();
app.use(express.json());

// ===================== FILE UPLOAD (real image upload, no links) =====================
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|png|webp|gif)/.test(file.mimetype)),
});
app.use('/uploads', express.static(UPLOAD_DIR));

app.post('/api/upload-image', requireTelegramAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل عکس ارسال نشد' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get('/', (req, res) => res.send('✅ starkadeh backend is running'));

// لینک‌های عمومی کانال/چت که مینی‌اپ برای دکمه‌های صفحه بازی‌ها ازش استفاده می‌کنه
let cachedBotUsername = null;
app.get('/api/config', async (req, res) => {
  if (!cachedBotUsername) {
    try { const me = await getMe(); cachedBotUsername = me.result?.username || null; } catch (e) {}
  }
  res.json({
    channel: process.env.REQUIRED_CHANNEL || process.env.COMMUNITY_CHANNEL || null,
    chat: process.env.COMMUNITY_CHAT || null,
    botUsername: cachedBotUsername,
    cardNumber: process.env.ADMIN_CARD_NUMBER || null,
    cardOwner: process.env.ADMIN_CARD_OWNER || null,
  });
});

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
const isAdmin = (id) => ADMIN_IDS.includes(Number(id));

/* =========================================================================
   MIDDLEWARE: every /api/* call from the Mini App must carry a valid
   Telegram initData string in the "X-Init-Data" header. This is how we
   know WHO is calling us without any separate login system.
   ========================================================================= */
async function requireTelegramAuth(req, res, next) {
  const initData = req.headers['x-init-data'];
  if (!initData) return res.status(401).json({ error: 'no init data' });
  const tgUser = validateInitData(initData, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: 'invalid init data' });

  const params = new URLSearchParams(initData);
  const startParam = params.get('start_param'); // carries ref_XXXXX if opened via referral link
  req.dbUser = getOrCreateUser(tgUser, startParam);

  // جوین اجباری کانال (اگه تو Variables تنظیم شده باشه)
  if (process.env.REQUIRED_CHANNEL) {
    const joined = await isChannelMember(process.env.REQUIRED_CHANNEL, tgUser.id);
    if (!joined) {
      return res.status(403).json({ error: 'join_required', channel: process.env.REQUIRED_CHANNEL });
    }
  }
  next();
}

/* =========================================================================
   MINI APP API
   ========================================================================= */

// current user + balances
app.get('/api/me', requireTelegramAuth, (req, res) => {
  res.json({
    tg_id: req.dbUser.tg_id,
    username: req.dbUser.username,
    first_name: req.dbUser.first_name,
    balance_rial: req.dbUser.balance_rial,
    balance_stars: req.dbUser.balance_stars,
    ref_code: req.dbUser.ref_code,
  });
});

// product catalog
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE active = 1').all();
  res.json(rows);
});

// helper: validate a cart items array against the real DB prices (never trust client prices)
function priceCart(items) {
  let total = 0;
  const resolved = [];
  for (const { productId, qty } of items) {
    const product = getProduct(productId);
    if (!product) throw new Error('product not found: ' + productId);
    const q = Math.max(1, Number(qty) || 1);
    total += product.price_rial * q;
    resolved.push({ product, qty: q });
  }
  return { total, resolved };
}

// checkout: pay with wallet balance (rial) — items: [{productId, qty}], note: آیدی گیرنده/اکانت مقصد
app.post('/api/checkout/wallet', requireTelegramAuth, (req, res) => {
  const { items, note } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'سبد خرید خالی است' });

  let total, resolved;
  try { ({ total, resolved } = priceCart(items)); }
  catch (e) { return res.status(404).json({ error: e.message }); }

  const user = getUser(req.dbUser.tg_id);
  if (user.balance_rial < total) return res.status(400).json({ error: 'موجودی کیف‌پول کافی نیست' });

  adjustBalance(user.tg_id, 'rial', -total, 'خرید از فروشگاه (کیف‌پول)');
  resolved.forEach(({ product, qty }) => {
    createOrder(user.tg_id, product.id, qty, product.price_rial * qty, 'wallet', note || null);
  });
  payReferralCommission(user.tg_id, total);

  sendMessage(user.tg_id, `✅ سفارش شما ثبت شد.\nمبلغ: ${total.toLocaleString()} تومان${note ? `\nمقصد: ${note}` : ''}`).catch(() => {});
  res.json({ ok: true, total });
});

// checkout: pay with Telegram Stars -> returns an invoice link, Mini App opens it with Telegram.WebApp.openInvoice()
app.post('/api/checkout/stars-invoice', requireTelegramAuth, async (req, res) => {
  const { items, note } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'سبد خرید خالی است' });

  let resolved;
  try { ({ resolved } = priceCart(items)); }
  catch (e) { return res.status(404).json({ error: e.message }); }

  const RIAL_PER_STAR = 385; // نرخ تبدیل داخلی خودتان - قابل تنظیم

  // هر کالا یک خط قیمت جدا در فاکتور استارز می‌شود؛ تلگرام خودش جمع می‌زند
  const prices = resolved.map(({ product, qty }) => ({
    label: `${product.name} ×${qty}`,
    amount: Math.ceil((product.price_rial * qty) / RIAL_PER_STAR),
  }));
  const payload = JSON.stringify({
    tg_id: req.dbUser.tg_id,
    items: resolved.map(({ product, qty }) => ({ productId: product.id, qty })),
    note: note || null,
  });

  const link = await createStarsInvoiceLink({
    title: 'خرید از استارکده',
    description: resolved.map(({ product, qty }) => `${product.name} ×${qty}`).join('، '),
    payload,
    prices,
  });
  res.json({ invoiceLink: link, totalStars: prices.reduce((s, p) => s + p.amount, 0) });
});

// checkout / topup: pay with rial payment gateway -> returns redirect URL
app.post('/api/gateway/start', requireTelegramAuth, async (req, res) => {
  const { purpose, amountRial, items, note } = req.body; // purpose: "topup" | "order"
  let amount = amountRial;
  let purposeTag = 'topup';

  if (purpose === 'order') {
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'سبد خرید خالی است' });
    let total;
    try { ({ total } = priceCart(items)); }
    catch (e) { return res.status(404).json({ error: e.message }); }
    amount = total;
    purposeTag = `order:${JSON.stringify({ items, note: note || null })}`;
  }

  if (!amount || amount < 1000) return res.status(400).json({ error: 'مبلغ نامعتبر است' });

  const { authority, payUrl } = await requestPayment({
    amountRial: amount,
    description: purpose === 'topup' ? 'شارژ کیف‌پول استارکده' : 'خرید از استارکده',
  });

  db.prepare(`INSERT INTO gateway_payments (authority, tg_id, amount_rial, purpose) VALUES (?,?,?,?)`)
    .run(authority, req.dbUser.tg_id, amount, purposeTag);

  res.json({ payUrl });
});

// user's own transaction history (wallet page)
app.get('/api/wallet/transactions', requireTelegramAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM transactions WHERE tg_id = ? ORDER BY created_at DESC LIMIT 40').all(req.dbUser.tg_id);
  res.json(rows);
});

// user's own order history (profile page)
app.get('/api/orders', requireTelegramAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE tg_id = ? ORDER BY created_at DESC LIMIT 30').all(req.dbUser.tg_id);
  res.json(rows);
});

// referral stats + invited list for the current user
app.get('/api/referral', requireTelegramAuth, (req, res) => {
  const invited = db.prepare('SELECT tg_id, username, first_name, created_at FROM users WHERE referred_by = ?').all(req.dbUser.tg_id);
  const totalEarned = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE tg_id = ? AND reason LIKE 'پورسانت%'`).get(req.dbUser.tg_id).s;
  res.json({
    ref_code: req.dbUser.ref_code,
    invited_count: invited.length,
    total_earned: totalEarned,
    invited,
  });
});

/* =========================================================================
   GIFT MARKET — بازار گیفت کاربران (امانی، مثل پرتال)
   ========================================================================= */
const GIFT_MARKET_FEE = Number(process.env.GIFT_MARKET_FEE_PERCENT || 5); // درصد کارمزد پلتفرم

// دسته‌بندی‌های بازار گیفت (از پنل ادمین مدیریت می‌شن)
app.get('/api/gift-categories', (req, res) => {
  res.json(listGiftCategories());
});

// آگهی‌های خودم (چه فروشنده باشم چه خریدار)
app.get('/api/gifts/my', requireTelegramAuth, (req, res) => {
  res.json(getMyListings(req.dbUser.tg_id));
});

// آگهی جدید — گیفت واقعی خودم رو برای فروش می‌ذارم
app.post('/api/gifts/list', requireTelegramAuth, (req, res) => {
  const { title, image_url, category, price } = req.body;
  const p = Number(price);
  if (!title || !p || p < 5000) return res.status(400).json({ error: 'عنوان و قیمت معتبر لازمه' });
  const id = createListing(req.dbUser.tg_id, title, image_url, category, p);
  res.json({ ok: true, id });
});

app.post('/api/gifts/:id/cancel', requireTelegramAuth, (req, res) => {
  try { cancelListing(req.dbUser.tg_id, req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// بازار — همه آگهی‌های در دسترس بقیه کاربرا (با فیلتر دسته‌بندی اختیاری)
app.get('/api/gifts/market', requireTelegramAuth, (req, res) => {
  res.json({ listings: getMarketListings(req.dbUser.tg_id, req.query.category), feePercent: GIFT_MARKET_FEE });
});

// خرید = رزرو + بلوکه شدن پول (امانت) — هنوز به فروشنده واریز نمی‌شه
app.post('/api/gifts/:id/buy', requireTelegramAuth, (req, res) => {
  try {
    const g = reserveListing(req.dbUser.tg_id, req.params.id);
    const buyer = req.dbUser;
    sendMessage(g.seller_tg_id,
      `🎁 گیفت «${g.title}» رزرو شد!\nخریدار: ${buyer.first_name || ''} ${buyer.username ? '@'+buyer.username : `(آیدی: ${buyer.tg_id})`}\n\nلطفاً گیفت رو مستقیم تو تلگرام براش بفرست. پول (${g.price_rial.toLocaleString()} ت منهای کارمزد) بعد از تایید خریدار به کیف‌پولت واریز می‌شه.`
    ).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// خریدار تایید می‌کنه گیفت واقعاً بهش رسیده -> پول امانت آزاد می‌شه به فروشنده
app.post('/api/gifts/:id/confirm-received', requireTelegramAuth, (req, res) => {
  try {
    const result = confirmReceived(req.dbUser.tg_id, req.params.id, GIFT_MARKET_FEE);
    sendMessage(result.seller_tg_id, `✅ خریدار دریافت گیفت «${result.title}» رو تایید کرد.\n+${result.sellerReceives.toLocaleString()} تومان به کیف‌پولت اضافه شد.`).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* =========================================================================
   DAILY WHEEL — چرخ شانس رایگان روزانه (بدون شرط‌بندی، فقط جایزه رایگان)
   ========================================================================= */
const WHEEL_REWARDS = [0, 2000, 5000, 5000, 10000, 20000, 50000]; // تومان — قابل تنظیم
const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

app.get('/api/wheel/status', requireTelegramAuth, (req, res) => {
  const user = getUser(req.dbUser.tg_id);
  const last = user.last_spin_at ? new Date(user.last_spin_at + 'Z').getTime() : 0;
  const nextAt = last + WHEEL_COOLDOWN_MS;
  res.json({ canSpin: Date.now() >= nextAt, nextSpinAt: nextAt, rewards: WHEEL_REWARDS });
});
app.post('/api/wheel/spin', requireTelegramAuth, (req, res) => {
  const user = getUser(req.dbUser.tg_id);
  const last = user.last_spin_at ? new Date(user.last_spin_at + 'Z').getTime() : 0;
  if (Date.now() < last + WHEEL_COOLDOWN_MS) return res.status(400).json({ error: 'فردا دوباره امتحان کن' });

  const reward = WHEEL_REWARDS[Math.floor(Math.random() * WHEEL_REWARDS.length)];
  db.prepare(`UPDATE users SET last_spin_at = datetime('now') WHERE tg_id = ?`).run(user.tg_id);
  if (reward > 0) adjustBalance(user.tg_id, 'rial', reward, 'جایزه چرخ شانس روزانه');
  res.json({ reward });
});

/* =========================================================================
   STAKING — کاربر بخشی از موجودی ریالی رو قفل می‌کنه و APR سالانه می‌گیره
   ========================================================================= */
const STAKE_APR = Number(process.env.STAKE_APR || 38);           // درصد سالانه
const STAKE_CAP_RIAL = Number(process.env.STAKE_CAP_RIAL || 50000000); // سقف استیک هر کاربر

app.get('/api/stake', requireTelegramAuth, (req, res) => {
  const user = getUser(req.dbUser.tg_id);
  res.json({
    staked_rial: user.staked_rial,
    pending_reward: pendingStakeReward(user, STAKE_APR),
    apr: STAKE_APR,
    cap_rial: STAKE_CAP_RIAL,
  });
});
app.post('/api/stake/deposit', requireTelegramAuth, (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount < 1000) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  try {
    stakeDeposit(req.dbUser.tg_id, amount, STAKE_APR, STAKE_CAP_RIAL);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/stake/withdraw', requireTelegramAuth, (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount < 1000) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  try {
    stakeWithdraw(req.dbUser.tg_id, amount, STAKE_APR);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* =========================================================================
   TASKS — تسک‌های قابل مدیریت از پنل ادمین
   ========================================================================= */
app.get('/api/tasks', requireTelegramAuth, (req, res) => {
  const tasks = listActiveTasks().map(t => ({ ...t, done: isTaskDone(req.dbUser.tg_id, t.id) }));
  res.json(tasks);
});
app.post('/api/tasks/:id/claim', requireTelegramAuth, async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'تسک پیدا نشد' });
  if (isTaskDone(req.dbUser.tg_id, task.id)) return res.status(400).json({ error: 'قبلاً این تسک رو انجام دادی' });

  if (task.type === 'join_channel') {
    const joined = await isChannelMember(task.channel_username, req.dbUser.tg_id);
    if (!joined) return res.status(400).json({ error: 'هنوز عضو کانال نشدی' });
  }
  completeTask(req.dbUser.tg_id, task);
  res.json({ ok: true });
});

// شارژ کیف‌پول با کارت‌به‌کارت — نیاز به تایید دستی ادمین داره
app.post('/api/wallet/card-topup', requireTelegramAuth, async (req, res) => {
  const amount = Number(req.body.amount);
  const trackingCode = String(req.body.trackingCode || '').trim();
  if (!amount || amount < 1000) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  if (!trackingCode) return res.status(400).json({ error: 'کد رهگیری یا ۴ رقم آخر کارت رو وارد کن' });

  const id = createManualPayment(req.dbUser.tg_id, amount, trackingCode);
  const adminIdsList = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const text = `💳 درخواست شارژ کارت‌به‌کارت\nکاربر: ${req.dbUser.first_name || ''} (${req.dbUser.tg_id})\nمبلغ: ${amount.toLocaleString()} تومان\nکد رهگیری: ${trackingCode}`;
  adminIdsList.forEach(id2 => {
    sendMessage(id2, text, {
      reply_markup: { inline_keyboard: [[
        { text: '✅ تایید و شارژ', callback_data: `approve_pay:${id}` },
        { text: '❌ رد', callback_data: `reject_pay:${id}` },
      ]] },
    }).catch(() => {});
  });
  res.json({ ok: true });
});

/* =========================================================================
   MULTI-CURRENCY WALLET — TON, USDT و هر ارز دیگه که از پنل تعریف بشه
   واریز/برداشت با تایید دستی ادمین (بدون هات‌والت خودکار، امن‌تر)
   ========================================================================= */
app.get('/api/currencies', (req, res) => {
  res.json(listCurrencies());
});
app.get('/api/wallet/balances', requireTelegramAuth, (req, res) => {
  res.json(getUserBalances(req.dbUser.tg_id));
});

app.post('/api/wallet/currency-deposit', requireTelegramAuth, (req, res) => {
  const { code, amount, txHash } = req.body;
  const currency = listCurrencies().find(c => c.code === code);
  if (!currency) return res.status(404).json({ error: 'ارز پیدا نشد' });
  const amt = Number(amount);
  if (!amt || amt < currency.min_amount) return res.status(400).json({ error: `حداقل مقدار واریز ${currency.min_amount} ${code} است` });
  if (!txHash) return res.status(400).json({ error: 'هش تراکنش یا کد رهگیری رو وارد کن' });

  const id = createCurrencyRequest(req.dbUser.tg_id, code, 'deposit', amt, null, txHash);
  const adminIdsList = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const text = `💰 درخواست واریز ${code}\nکاربر: ${req.dbUser.first_name || ''} (${req.dbUser.tg_id})\nمقدار: ${amt} ${code}\nهش تراکنش: ${txHash}`;
  adminIdsList.forEach(id2 => {
    sendMessage(id2, text, {
      reply_markup: { inline_keyboard: [[
        { text: '✅ تایید و شارژ', callback_data: `approve_cdep:${id}` },
        { text: '❌ رد', callback_data: `reject_cdep:${id}` },
      ]] },
    }).catch(() => {});
  });
  res.json({ ok: true });
});

app.post('/api/wallet/currency-withdraw', requireTelegramAuth, (req, res) => {
  const { code, amount, address } = req.body;
  const currency = listCurrencies().find(c => c.code === code);
  if (!currency) return res.status(404).json({ error: 'ارز پیدا نشد' });
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'مقدار نامعتبر است' });
  if (!address) return res.status(400).json({ error: 'آدرس مقصد رو وارد کن' });
  const balance = getCurrencyBalance(req.dbUser.tg_id, code);
  if (balance < amt) return res.status(400).json({ error: 'موجودی کافی نیست' });

  adjustCurrencyBalance(req.dbUser.tg_id, code, -amt); // بلوکه فوری تا رسیدگی ادمین
  const id = createCurrencyRequest(req.dbUser.tg_id, code, 'withdraw', amt, address, null);
  const adminIdsList = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const text = `📤 درخواست برداشت ${code}\nکاربر: ${req.dbUser.first_name || ''} (${req.dbUser.tg_id})\nمقدار: ${amt} ${code}\nآدرس مقصد: ${address}`;
  adminIdsList.forEach(id2 => {
    sendMessage(id2, text, {
      reply_markup: { inline_keyboard: [[
        { text: '✅ ارسال شد', callback_data: `approve_cwd:${id}` },
        { text: '❌ رد و برگشت وجه', callback_data: `reject_cwd:${id}` },
      ]] },
    }).catch(() => {});
  });
  res.json({ ok: true });
});

// برداشت ریالی (کارت‌به‌کارت دستی) — کنار شارژ کیف‌پول
app.post('/api/wallet/rial-withdraw', requireTelegramAuth, (req, res) => {
  const amount = Number(req.body.amount);
  const cardNumber = String(req.body.cardNumber || '').trim();
  if (!amount || amount < 10000) return res.status(400).json({ error: 'حداقل مبلغ برداشت ۱۰,۰۰۰ تومانه' });
  if (!cardNumber) return res.status(400).json({ error: 'شماره کارت مقصد رو وارد کن' });
  const user = getUser(req.dbUser.tg_id);
  if (user.balance_rial < amount) return res.status(400).json({ error: 'موجودی کافی نیست' });

  adjustBalance(user.tg_id, 'rial', -amount, 'درخواست برداشت ریالی (در انتظار تایید)');
  const id = createCurrencyRequest(user.tg_id, 'RIAL', 'withdraw', amount, cardNumber, null);
  const adminIdsList = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const text2 = `📤 درخواست برداشت ریالی\nکاربر: ${req.dbUser.first_name || ''} (${req.dbUser.tg_id})\nمبلغ: ${amount.toLocaleString()} تومان\nشماره کارت: ${cardNumber}`;
  adminIdsList.forEach(id2 => {
    sendMessage(id2, text2, {
      reply_markup: { inline_keyboard: [[
        { text: '✅ ارسال شد', callback_data: `approve_cwd:${id}` },
        { text: '❌ رد و برگشت وجه', callback_data: `reject_cwd:${id}` },
      ]] },
    }).catch(() => {});
  });
  res.json({ ok: true });
});

/* =========================================================================
   CARD GAME — فروشگاه کارت، مچ‌سازی ۱به۱، لیدربورد
   ========================================================================= */
const GAME_DAILY_LIMIT = Number(process.env.GAME_DAILY_LIMIT || 5);
const GAME_MIN_DECK_SIZE = Number(process.env.GAME_MIN_DECK_SIZE || 5);
const GAME_EXTRA_PLAY_PRICE = Number(process.env.GAME_EXTRA_PLAY_PRICE_RIAL || 20000);
const GAME_EXTRA_PLAY_COUNT = Number(process.env.GAME_EXTRA_PLAY_COUNT || 3);

app.get('/api/game/cards', (req, res) => {
  res.json(listGameCards());
});
app.get('/api/game/my-cards', requireTelegramAuth, (req, res) => {
  res.json(getUserCards(req.dbUser.tg_id));
});
app.post('/api/game/buy-card', requireTelegramAuth, (req, res) => {
  try { buyGameCard(req.dbUser.tg_id, req.body.cardId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/game/upgrade-card', requireTelegramAuth, (req, res) => {
  try { const result = upgradeUserCard(req.dbUser.tg_id, req.body.userCardId); res.json({ ok: true, ...result }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/game/status', requireTelegramAuth, (req, res) => {
  const remaining = getPlaysRemaining(req.dbUser.tg_id, GAME_DAILY_LIMIT);
  const q = getQueueStatus(req.dbUser.tg_id);
  res.json({
    dailyLimit: GAME_DAILY_LIMIT, playsRemaining: remaining, minDeckSize: GAME_MIN_DECK_SIZE,
    extraPlayPrice: GAME_EXTRA_PLAY_PRICE, extraPlayCount: GAME_EXTRA_PLAY_COUNT,
    rank: getMyRank(req.dbUser.tg_id), ...q,
  });
});
app.post('/api/game/buy-extra-plays', requireTelegramAuth, (req, res) => {
  const user = getUser(req.dbUser.tg_id);
  if (user.balance_rial < GAME_EXTRA_PLAY_PRICE) return res.status(400).json({ error: 'موجودی کافی نیست' });
  adjustBalance(user.tg_id, 'rial', -GAME_EXTRA_PLAY_PRICE, 'خرید بازی اضافه');
  addExtraPlays(user.tg_id, GAME_EXTRA_PLAY_COUNT);
  res.json({ ok: true, added: GAME_EXTRA_PLAY_COUNT });
});
app.post('/api/game/queue', requireTelegramAuth, (req, res) => {
  const remaining = getPlaysRemaining(req.dbUser.tg_id, GAME_DAILY_LIMIT);
  if (remaining <= 0) return res.status(400).json({ error: 'سهمیه بازی امروزت تموم شده' });
  try {
    const result = joinQueue(req.dbUser.tg_id, req.body.cardIds, GAME_MIN_DECK_SIZE);
    if (result.matched && result.opponentTgId) {
      const won = result.won;
      sendMessage(result.opponentTgId, won
        ? `⚔️ مسابقه پیدا شد! متاسفانه باختی.\nقدرت تو: ${result.oppPower} | حریف: ${result.myPower}`
        : `⚔️ مسابقه پیدا شد! بردی 🎉\nقدرت تو: ${result.oppPower} | حریف: ${result.myPower}`
      ).catch(() => {});
    }
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/game/queue-status', requireTelegramAuth, (req, res) => {
  res.json(getQueueStatus(req.dbUser.tg_id));
});
app.post('/api/game/queue/cancel', requireTelegramAuth, (req, res) => {
  cancelQueue(req.dbUser.tg_id);
  res.json({ ok: true });
});
app.get('/api/game/leaderboard', (req, res) => {
  res.json({ rows: getLeaderboard(50), prizes: listLeaderboardPrizes() });
});

// gateway calls this URL back after the user finishes paying (set as ZARINPAL_CALLBACK_URL)
app.get('/gateway/verify', async (req, res) => {
  const { Authority, Status } = req.query;
  const record = db.prepare('SELECT * FROM gateway_payments WHERE authority = ?').get(Authority);
  if (!record) return res.status(404).send('پرداخت پیدا نشد');

  if (Status !== 'OK') {
    db.prepare(`UPDATE gateway_payments SET status = 'failed' WHERE authority = ?`).run(Authority);
    return res.send('پرداخت لغو شد. می‌توانید این صفحه را ببندید و به ربات بازگردید.');
  }

  const { ok, refId } = await verifyPayment({ authority: Authority, amountRial: record.amount_rial });
  if (!ok) {
    db.prepare(`UPDATE gateway_payments SET status = 'failed' WHERE authority = ?`).run(Authority);
    return res.send('تایید پرداخت ناموفق بود.');
  }

  db.prepare(`UPDATE gateway_payments SET status = 'paid' WHERE authority = ?`).run(Authority);

  if (record.purpose === 'topup') {
    adjustBalance(record.tg_id, 'rial', record.amount_rial, 'شارژ کیف‌پول از درگاه', refId);
    sendMessage(record.tg_id, `✅ کیف‌پول شما به مبلغ ${record.amount_rial.toLocaleString()} تومان شارژ شد.`);
  } else if (record.purpose.startsWith('order:')) {
    const { items, note } = JSON.parse(record.purpose.slice('order:'.length));
    items.forEach(({ productId, qty }) => {
      const product = getProduct(productId);
      if (product) createOrder(record.tg_id, productId, qty, product.price_rial * qty, 'gateway', note || null);
    });
    payReferralCommission(record.tg_id, record.amount_rial);
    sendMessage(record.tg_id, `✅ پرداخت شما تایید شد و سفارش ثبت گردید.${note ? `\nمقصد: ${note}` : ''}`);
  }

  res.send('پرداخت با موفقیت انجام شد ✅ می‌توانید به ربات بازگردید.');
});

/* =========================================================================
   TELEGRAM WEBHOOK — receives all bot updates (messages + payments)
   ========================================================================= */
app.post('/telegram-webhook', async (req, res) => {
  // امنیت: تلگرام هدر secret token شما را در هر درخواست برمی‌گرداند
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.sendStatus(200); // پاسخ فوری به تلگرام؛ پردازش را بعد از آن انجام می‌دهیم

  const update = req.body;

  // 1) کاربر ربات را استارت کرده -> پیام خوش‌آمد + دکمه باز کردن مینی‌اپ
  if (update.message?.text?.startsWith('/start')) {
    const chatId = update.message.chat.id;
    const refParam = update.message.text.split(' ')[1]; // مثلاً ref_123456 — دیگه پیشوند رو حذف نمی‌کنیم چون دقیقاً با ref_code دیتابیس باید یکی باشه
    getOrCreateUser(update.message.from, refParam);

    if (process.env.REQUIRED_CHANNEL) {
      const joined = await isChannelMember(process.env.REQUIRED_CHANNEL, update.message.from.id);
      if (!joined) {
        await sendMessage(chatId, `برای استفاده از ربات، اول باید عضو کانال ما بشی:`, {
          reply_markup: { inline_keyboard: [
            [{ text: '📢 عضویت در کانال', url: `https://t.me/${process.env.REQUIRED_CHANNEL.replace('@','')}` }],
            [{ text: '✅ عضو شدم، بررسی کن', callback_data: 'check_join' }],
          ] },
        });
        return;
      }
    }

    await sendMessage(chatId, 'به <b>استارکده</b> خوش اومدی ✨\nاز دکمه پایین فروشگاه رو باز کن:', {
      reply_markup: {
        inline_keyboard: [[{ text: '🛍 باز کردن فروشگاه', web_app: { url: process.env.PUBLIC_URL + '/miniapp' } }]],
      },
    });
    return;
  }

  // 1b) دکمه «عضو شدم، بررسی کن»
  if (update.callback_query?.data === 'check_join') {
    answerCallbackQuery(update.callback_query.id).catch(() => {});
    const chatId = update.callback_query.message.chat.id;
    const joined = !process.env.REQUIRED_CHANNEL || await isChannelMember(process.env.REQUIRED_CHANNEL, update.callback_query.from.id);
    if (joined) {
      await sendMessage(chatId, 'عضویت تایید شد ✅ از دکمه پایین فروشگاه رو باز کن:', {
        reply_markup: { inline_keyboard: [[{ text: '🛍 باز کردن فروشگاه', web_app: { url: process.env.PUBLIC_URL + '/miniapp' } }]] },
      });
    } else {
      await sendMessage(chatId, '❌ هنوز عضو کانال نشدی.');
    }
    return;
  }

  // 1c) ادمین دکمه تایید/رد کارت‌به‌کارت رو زده
  if (update.callback_query?.data?.startsWith('approve_pay:') || update.callback_query?.data?.startsWith('reject_pay:')) {
    const cq = update.callback_query;
    answerCallbackQuery(cq.id).catch(() => {});
    if (!isAdmin(cq.from.id)) { answerCallbackQuery(cq.id, 'فقط ادمین اجازه داره').catch(() => {}); return; }

    const [action, idStr] = cq.data.split(':');
    const payment = getManualPayment(idStr);
    if (!payment || payment.status !== 'pending') {
      await sendMessage(cq.message.chat.id, 'این درخواست قبلاً پردازش شده.');
      return;
    }
    if (action === 'approve_pay') {
      setManualPaymentStatus(payment.id, 'approved');
      adjustBalance(payment.tg_id, 'rial', payment.amount_rial, 'شارژ کیف‌پول (کارت‌به‌کارت، تاییدشده)');
      await sendMessage(cq.message.chat.id, `✅ تایید شد و ${payment.amount_rial.toLocaleString()} تومان به کاربر ${payment.tg_id} اضافه شد.`);
      await sendMessage(payment.tg_id, `✅ شارژ کارت‌به‌کارت شما تایید شد.\n+${payment.amount_rial.toLocaleString()} تومان به کیف‌پولت اضافه شد.`);
    } else {
      setManualPaymentStatus(payment.id, 'rejected');
      await sendMessage(cq.message.chat.id, `❌ درخواست رد شد.`);
      await sendMessage(payment.tg_id, `❌ متاسفانه شارژ کارت‌به‌کارت شما تایید نشد. با پشتیبانی در ارتباط باش.`);
    }
    return;
  }

  // 1d) ادمین دکمه تایید/رد واریز ارزی (TON/USDT/...) رو زده
  if (update.callback_query?.data?.startsWith('approve_cdep:') || update.callback_query?.data?.startsWith('reject_cdep:')) {
    const cq = update.callback_query;
    answerCallbackQuery(cq.id).catch(() => {});
    if (!isAdmin(cq.from.id)) { answerCallbackQuery(cq.id, 'فقط ادمین اجازه داره').catch(() => {}); return; }

    const [action, idStr] = cq.data.split(':');
    const reqRow = getCurrencyRequest(idStr);
    if (!reqRow || reqRow.status !== 'pending') {
      await sendMessage(cq.message.chat.id, 'این درخواست قبلاً پردازش شده.');
      return;
    }
    if (action === 'approve_cdep') {
      setCurrencyRequestStatus(reqRow.id, 'approved');
      adjustCurrencyBalance(reqRow.tg_id, reqRow.currency_code, reqRow.amount);
      await sendMessage(cq.message.chat.id, `✅ تایید شد و ${reqRow.amount} ${reqRow.currency_code} به کاربر ${reqRow.tg_id} اضافه شد.`);
      await sendMessage(reqRow.tg_id, `✅ واریز ${reqRow.amount} ${reqRow.currency_code} تایید شد و به کیف‌پولت اضافه شد.`);
    } else {
      setCurrencyRequestStatus(reqRow.id, 'rejected');
      await sendMessage(cq.message.chat.id, `❌ درخواست رد شد.`);
      await sendMessage(reqRow.tg_id, `❌ واریز ${reqRow.currency_code} شما تایید نشد. با پشتیبانی در ارتباط باش.`);
    }
    return;
  }

  // 1e) ادمین دکمه تایید/رد برداشت ارزی رو زده
  if (update.callback_query?.data?.startsWith('approve_cwd:') || update.callback_query?.data?.startsWith('reject_cwd:')) {
    const cq = update.callback_query;
    answerCallbackQuery(cq.id).catch(() => {});
    if (!isAdmin(cq.from.id)) { answerCallbackQuery(cq.id, 'فقط ادمین اجازه داره').catch(() => {}); return; }

    const [action, idStr] = cq.data.split(':');
    const reqRow = getCurrencyRequest(idStr);
    if (!reqRow || reqRow.status !== 'pending') {
      await sendMessage(cq.message.chat.id, 'این درخواست قبلاً پردازش شده.');
      return;
    }
    if (action === 'approve_cwd') {
      setCurrencyRequestStatus(reqRow.id, 'approved'); // موجودی از قبل موقع درخواست کسر شده بود
      const label = reqRow.currency_code === 'RIAL' ? `${reqRow.amount.toLocaleString()} تومان` : `${reqRow.amount} ${reqRow.currency_code}`;
      await sendMessage(cq.message.chat.id, `✅ ثبت شد. یادت نره ${label} رو دستی به مقصد زیر بفرستی:\n${reqRow.address}`);
      await sendMessage(reqRow.tg_id, `✅ برداشت ${label} انجام و ارسال شد.`);
    } else {
      setCurrencyRequestStatus(reqRow.id, 'rejected');
      if (reqRow.currency_code === 'RIAL') {
        adjustBalance(reqRow.tg_id, 'rial', reqRow.amount, 'بازگشت وجه برداشت ردشده');
      } else {
        adjustCurrencyBalance(reqRow.tg_id, reqRow.currency_code, reqRow.amount); // برگشت وجه بلوکه‌شده
      }
      const label = reqRow.currency_code === 'RIAL' ? 'ریالی' : reqRow.currency_code;
      await sendMessage(cq.message.chat.id, `↩️ درخواست رد شد و موجودی برگشت.`);
      await sendMessage(reqRow.tg_id, `❌ برداشت ${label} شما رد شد و مبلغ به کیف‌پولت برگشت.`);
    }
    return;
  }

  // 2) دستورات مدیریتی ادمین در چت با ربات
  if (update.message?.text && isAdmin(update.message.from.id)) {
    const [cmd, ...args] = update.message.text.trim().split(' ');
    const chatId = update.message.chat.id;

    if (cmd === '/stats') {
      const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      const rialIn = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='in' AND currency='rial'`).get().s;
      const orders = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
      await sendMessage(chatId, `📊 آمار کلی\nکاربران: ${users}\nسفارش‌ها: ${orders}\nمجموع واریزی: ${rialIn.toLocaleString()} تومان`);
    }

    if (cmd === '/addbalance' && args.length === 2) {
      const [targetId, amount] = args;
      adjustBalance(Number(targetId), 'rial', Number(amount), 'شارژ دستی توسط ادمین');
      await sendMessage(chatId, `✅ ${amount} تومان به کیف‌پول ${targetId} اضافه شد.`);
      await sendMessage(Number(targetId), `💰 مبلغ ${Number(amount).toLocaleString()} تومان توسط پشتیبانی به کیف‌پول شما اضافه شد.`);
    }
  }

  // 3) پیش از پرداخت استارز -> باید طی ۱۰ ثانیه تایید شود
  if (update.pre_checkout_query) {
    await answerPreCheckoutQuery(update.pre_checkout_query.id, true);
    return;
  }

  // 4) پرداخت استارز با موفقیت انجام شد -> تحویل کالا / شارژ موجودی
  if (update.message?.successful_payment) {
    const sp = update.message.successful_payment;
    const payload = JSON.parse(sp.invoice_payload);

    let names = [];
    payload.items.forEach(({ productId, qty }) => {
      const product = getProduct(productId);
      if (!product) return;
      createOrder(payload.tg_id, productId, qty, product.price_rial * qty, 'stars', payload.note || null);
      names.push(`${product.name} ×${qty}`);
    });
    const totalRial = payload.items.reduce((s, { productId, qty }) => {
      const p = getProduct(productId);
      return s + (p ? p.price_rial * qty : 0);
    }, 0);
    payReferralCommission(payload.tg_id, totalRial);

    await sendMessage(payload.tg_id, `✅ پرداخت با ${sp.total_amount}⭐️ موفق بود.\nسفارش: ${names.join('، ')}${payload.note ? `\nمقصد: ${payload.note}` : ''}`);
  }
});

/* =========================================================================
   SERVE THE MINI APP FRONTEND (the HTML file from earlier)
   ========================================================================= */
app.use('/miniapp', express.static('public')); // put starkadeh-miniapp.html as public/index.html
app.use('/admin/api', adminRouter);            // admin panel API (password protected, see admin.js)
app.use('/admin', express.static('admin-panel')); // admin panel frontend (admin-panel/index.html)

app.listen(process.env.PORT || 3000, async () => {
  console.log(`🚀 server running on port ${process.env.PORT || 3000}`);
  if (process.env.PUBLIC_URL) {
    const r = await setWebhook(`${process.env.PUBLIC_URL}/telegram-webhook`, process.env.WEBHOOK_SECRET);
    console.log('webhook set:', r.ok);
  }
});
