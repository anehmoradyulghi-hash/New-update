// نمونه اتصال به درگاه زرین‌پال. اگر از درگاه دیگری (زیبال، آیدی‌پی و ...) استفاده می‌کنید،
// فقط کافیست همین دو تابع (requestPayment و verifyPayment) را مطابق مستندات همان درگاه بازنویسی کنید.

const MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const CALLBACK_URL = process.env.ZARINPAL_CALLBACK_URL;

const REQUEST_URL = 'https://api.zarinpal.com/pg/v4/payment/request.json';
const VERIFY_URL = 'https://api.zarinpal.com/pg/v4/payment/verify.json';
const STARTPAY_URL = 'https://www.zarinpal.com/pg/StartPay/';

// amountRial: مبلغ به تومان ضربدر ۱۰ می‌شود چون زرین‌پال با ریال کار می‌کند
export async function requestPayment({ amountRial, description, mobile }) {
  const res = await fetch(REQUEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: MERCHANT_ID,
      amount: amountRial * 10,
      description,
      callback_url: CALLBACK_URL,
      metadata: mobile ? { mobile } : {},
    }),
  });
  const data = await res.json();
  if (data.data && data.data.code === 100) {
    return { authority: data.data.authority, payUrl: STARTPAY_URL + data.data.authority };
  }
  throw new Error('zarinpal request failed: ' + JSON.stringify(data.errors));
}

export async function verifyPayment({ authority, amountRial }) {
  const res = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_id: MERCHANT_ID, amount: amountRial * 10, authority }),
  });
  const data = await res.json();
  const ok = data.data && (data.data.code === 100 || data.data.code === 101);
  return { ok, refId: data.data?.ref_id };
}
