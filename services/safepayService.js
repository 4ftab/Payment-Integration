const axios = require("axios");
const crypto = require("crypto");

const ENV = process.env.SAFEPAY_ENV === "production" ? "production" : "sandbox";
const API_URL = ENV === "production"
    ? "https://api.getsafepay.com"
    : "https://sandbox.api.getsafepay.com";

// Creates a payment tracker for the given amount.
async function createTracker(amount, currency) {
    const response = await axios.post(`${API_URL}/order/v1/init`, {
        client: process.env.SAFEPAY_PUBLIC_KEY,
        amount,
        currency,
        environment: ENV
    });
    const token = response.data?.data?.token;
    if (!token) throw new Error("Safepay did not return a tracker token");
    return token;
}

// Asks Safepay for the tracker state; returns PAID, FAILED or PENDING.
// This works locally, unlike webhooks which need a public URL.
async function fetchStatus(tracker) {
    const response = await axios.get(`${API_URL}/order/v1/${tracker}`, {
        headers: { "X-SFPY-MERCHANT-SECRET": process.env.SAFEPAY_SECRET_KEY }
    });
    const state = String(response.data?.data?.state || "").toUpperCase();
    if (state === "TRACKER_ENDED" || state === "PAID") return "PAID";
    if (state.includes("CANCEL") || state.includes("FAIL")) return "FAILED";
    return "PENDING";
}

// Hosted checkout URL the customer is redirected to.
function buildCheckoutUrl({ tracker, orderId, baseUrl }) {
    const params = new URLSearchParams({
        env: ENV,
        beacon: tracker,
        source: "custom",
        order_id: orderId,
        redirect_url: `${baseUrl}/payments/success`,
        cancel_url: `${baseUrl}/payments/cancel`
    });
    return `${API_URL}/checkout/pay?${params}`;
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a || ""));
    const y = Buffer.from(String(b || ""));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Webhook: HMAC-SHA512 of the raw body using the webhook shared secret.
function verifyWebhook(rawBody, signature) {
    const secret = process.env.SAFEPAY_WEBHOOK_SECRET;
    if (!secret || !rawBody) return false;
    const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
}

// Redirect: HMAC-SHA256 of the tracker using the secret key.
function verifyRedirect(tracker, sig) {
    const secret = process.env.SAFEPAY_SECRET_KEY;
    if (!secret || !tracker) return false;
    const expected = crypto.createHmac("sha256", secret).update(tracker).digest("hex");
    return safeEqual(expected, sig);
}

module.exports = { createTracker, fetchStatus, buildCheckoutUrl, verifyWebhook, verifyRedirect };
