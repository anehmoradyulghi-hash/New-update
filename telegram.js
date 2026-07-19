import crypto from 'crypto';

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function call(method, payload) {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) console.error(`[telegram:${method}]`, data);
    return data;
  } catch (e) {
    console.error(`[telegram:${method}] network/parse error`, e.message);
    return { ok: false, error: e.message };
  }
}

export const sendMessage = (chatId, text, extra = {}) =>
  call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

export const answerPreCheckoutQuery = (id, ok, error_message) =>
  call('answerPreCheckoutQuery', { pre_checkout_query_id: id, ok, ...(error_message ? { error_message } : {}) });

export const answerCallbackQuery = (id, text) =>
  call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });

// Creates a Telegram Stars invoice link. Currency MUST be "XTR" for Stars, provider_token stays empty.
// `prices`: array of {label, amount} — one line per cart item; Telegram sums them automatically.
export async function createStarsInvoiceLink({ title, description, payload, prices }) {
  const data = await call('createInvoiceLink', {
    title,
    description,
    payload,                 // opaque string YOU define, returned to you on successful_payment
    provider_token: '',      // empty for Telegram Stars
    currency: 'XTR',
    prices,                  // for XTR, amount = number of stars (no decimals)
  });
  return data.result; // invoice link URL
}

export const setWebhook = (url, secretToken) =>
  call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message', 'pre_checkout_query', 'callback_query'] });

// چک عضویت کاربر در یک کانال/گروه (برای جوین اجباری)
export async function isChannelMember(channelUsername, userId) {
  if (!channelUsername) return true; // اگه کانالی تنظیم نشده، محدودیتی نیست
  const data = await call('getChatMember', { chat_id: '@' + channelUsername.replace('@', ''), user_id: userId });
  if (!data.ok) {
    // اگه نتونستیم وضعیت عضویت رو چک کنیم (قطعی شبکه، محدودیت API و...)، کاربر رو مسدود نمی‌کنیم
    if (data.error) return true;
    return false;
  }
  return !['left', 'kicked'].includes(data.result.status);
}

export const getMe = () => call('getMe', {});

// ---- Validates the `initData` string the Mini App sends with every API request ----
// Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function validateInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  // optional: reject stale initData (older than 24h)
  const authDate = Number(params.get('auth_date')) * 1000;
  if (Date.now() - authDate > 24 * 60 * 60 * 1000) return null;

  const userJson = params.get('user');
  return userJson ? JSON.parse(userJson) : null;
}
