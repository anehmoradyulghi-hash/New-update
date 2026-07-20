// gateway.js - سیستم پرداخت داخلی برای TON و USDT

/**
 * ایجاد یک تراکنش جدید در سیستم
 * به جای فراخوانی API زرین‌پال، تراکنش را در وضعیت "در انتظار" (pending) ذخیره می‌کنیم.
 */
export async function requestPayment({ userId, amount, currency, description }) {
    // در اینجا باید فراخوانی به db.js داشته باشید تا تراکنش را ثبت کنید
    // فرض می‌کنیم تابع createPayment در db.js وجود دارد (یا باید اضافه شود)
    
    // شبیه‌سازی ایجاد تراکنش
    const paymentId = `tx_${Date.now()}_${userId}`;
    
    // ثبت در دیتابیس (باید تابع مربوطه را در db.js بسازید)
    // await db.run('INSERT INTO payments (id, userId, amount, currency, status, description) VALUES (?, ?, ?, ?, ?, ?)', 
    //    [paymentId, userId, amount, currency, 'pending', description]);

    console.log(`[Payment] New intent created: ${paymentId} for user ${userId}`);

    // بازگرداندن اطلاعات برای نمایش به کاربر
    return {
        status: 'success',
        paymentId: paymentId,
        message: 'تراکنش ثبت شد. لطفا مبلغ را به آدرس کیف پول واریز کنید.'
    };
}

/**
 * تایید پرداخت
 * به جای استعلام از API زرین‌پال، وضعیت تراکنش را از دیتابیس چک می‌کنیم.
 */
export async function verifyPayment({ paymentId }) {
    // در اینجا باید وضعیت پرداخت را از دیتابیس چک کنید
    // const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);

    // منطق تایید:
    // اگر ادمین تایید کرده باشد یا سیستم خودکار تایید کرده باشد:
    const isPaid = false; // اینجا باید وضعیت واقعی از دیتابیس خوانده شود

    if (isPaid) {
        return { status: 'success', message: 'پرداخت تایید شد.' };
    } else {
        return { status: 'pending', message: 'پرداخت هنوز تایید نشده است.' };
    }
}
