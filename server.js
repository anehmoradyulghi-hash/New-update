import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db, {
  getUser,
  upsertUser,
  addTransaction,
  createGatewayPayment,
  getGatewayPayment,
  markGatewayPaymentPaid
} from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-now';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// =========================
// Helpers
// =========================
function ok(res, data = {}) {
  return res.json({ ok: true, ...data });
}

function fail(res, status = 400, message = 'خطا رخ داد', extra = {}) {
  return res.status(status).json({ ok: false, message, ...extra });
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeCurrency(currency) {
  return String(currency || '').trim().toUpperCase();
}

function isPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function getBodyUser(req) {
  const tg_id = Number(req.body?.tg_id || req.body?.userId || req.body?.user_id);
  const username = req.body?.username || null;
  const first_name = req.body?.first_name || req.body?.firstName || null;
  return { tg_id, username, first_name };
}

function requireAdmin(req, res) {
  const secret = req.headers['x-admin-secret'] || req.body?.adminSecret || req.query?.adminSecret;
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    fail(res, 403, 'Access denied');
    return false;
  }
  return true;
}

// =========================
// Health
// =========================
app.get('/health', (req, res) => {
  ok(res, {
    status: 'healthy',
    time: nowISO(),
    service: 'starkadeh-server'
  });
});

// =========================
// User bootstrap
// =========================
app.post('/api/user/bootstrap', (req, res) => {
  try {
    const { tg_id, username, first_name } = getBodyUser(req);

    if (!tg_id) return fail(res, 400, 'tg_id is required');

    upsertUser({
      tg_id,
      username,
      first_name,
      ref_code: null,
      referred_by: null
    });

    const user = getUser(tg_id);
    return ok(res, { user });
  } catch (err) {
    console.error('bootstrap error:', err);
    return fail(res, 500, 'خطا در ثبت کاربر');
  }
});

app.get('/api/user/:tgId', (req, res) => {
  try {
    const tgId = Number(req.params.tgId);
    if (!tgId) return fail(res, 400, 'Invalid tgId');

    const user = getUser(tgId);
    if (!user) return fail(res, 404, 'User not found');

    return ok(res, { user });
  } catch (err) {
    console.error('get user error:', err);
    return fail(res, 500, 'خطا در دریافت کاربر');
  }
});

// =========================
// Store / Products
// =========================
app.get('/api/products', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM products
      WHERE active = 1
      ORDER BY created_at DESC
    `).all();

    return ok(res, { products: rows });
  } catch (err) {
    console.error('products error:', err);
    return fail(res, 500, 'خطا در دریافت محصولات');
  }
});

app.post('/api/products', (req, res) => {
  try {
    const { id, title, category, price_rial, image_url = null } = req.body;

    if (!id || !title || !category || !isPositiveNumber(price_rial)) {
      return fail(res, 400, 'Invalid product data');
    }

    db.prepare(`
      INSERT INTO products (id, title, category, price_rial, image_url, active)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        price_rial = excluded.price_rial,
        image_url = excluded.image_url,
        active = 1
    `).run(id, title, category, Number(price_rial), image_url);

    return ok(res, { message: 'Product saved' });
  } catch (err) {
    console.error('save product error:', err);
    return fail(res, 500, 'خطا در ذخیره محصول');
  }
});

// =========================
// Orders
// =========================
app.post('/api/orders', (req, res) => {
  try {
    const { tg_id, product_id, qty = 1, pay_method = 'wallet', note = null } = req.body;

    if (!tg_id || !product_id || !isPositiveNumber(qty)) {
      return fail(res, 400, 'Invalid order data');
    }

    const product = db.prepare(`SELECT * FROM products WHERE id = ? AND active = 1`).get(product_id);
    if (!product) return fail(res, 404, 'Product not found');

    const amount_rial = Number(product.price_rial) * Number(qty);

    const result = db.prepare(`
      INSERT INTO orders (tg_id, product_id, qty, amount_rial, pay_method, status, note)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(Number(tg_id), product_id, Number(qty), amount_rial, pay_method, note);

    return ok(res, {
      orderId: result.lastInsertRowid,
      amount_rial
    });
  } catch (err) {
    console.error('create order error:', err);
    return fail(res, 500, 'خطا در ثبت سفارش');
  }
});

app.get('/api/orders/:tgId', (req, res) => {
  try {
    const tgId = Number(req.params.tgId);
    if (!tgId) return fail(res, 400, 'Invalid tgId');

    const orders = db.prepare(`
      SELECT o.*, p.title AS product_title, p.image_url AS product_image
      FROM orders o
      LEFT JOIN products p ON p.id = o.product_id
      WHERE o.tg_id = ?
      ORDER BY o.created_at DESC
    `).all(tgId);

    return ok(res, { orders });
  } catch (err) {
    console.error('get orders error:', err);
    return fail(res, 500, 'خطا در دریافت سفارش‌ها');
  }
});

// =========================
// Payment intent (internal TON/USDT flow)
// =========================
app.post('/api/create-payment', (req, res) => {
  try {
    const { tg_id, purpose = 'store_checkout', amount_rial, currency = 'TON' } = req.body;

    if (!tg_id || !isPositiveNumber(amount_rial)) {
      return fail(res, 400, 'Invalid payment request');
    }

    const cur = normalizeCurrency(currency);
    if (!['TON', 'USDT'].includes(cur)) {
      return fail(res, 400, 'Unsupported currency');
    }

    const authority = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    createGatewayPayment({
      authority,
      tg_id: Number(tg_id),
      purpose: String(purpose),
      amount_rial: Number(amount_rial)
    });

    return
