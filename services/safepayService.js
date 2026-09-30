const axios = require("axios");
const crypto = require("crypto");

const ENV =
    process.env.SAFEPAY_ENV === "production" ? "production" : "sandbox";

const API_URL =
    ENV === "production"
        ? "https://api.getsafepay.com"
        : "https://sandbox.api.getsafepay.com";

/**
 * Step 1 of checkout: ask Safepay for a "tracker" (a payment session).
 * This is the same call you already had, and it works for you, so we keep it.
 */
async function createTracker(amount, currency) {
    const response = await axios.post(
        `${API_URL}/order/v1/init`,
        {
            client: process.env.SAFEPAY_PUBLIC_KEY,
            amount,
            currency,
            environment: ENV
        },
        { timeout: 15000 }
    );

    const token = response.data?.data?.token;

    if (!token) {
        throw new Error("Safepay did not return a tracker token");
    }

    return token;
}

/**
 * Ask Safepay "what happened to this tracker?".
 *
 * Official docs: GET /reporter/api/v1/payments/{tracker}
 * (your old code did POST /order/payments/v3/{tracker}, which is the
 *  endpoint for CREATING a payment session, not for reading one).
 *
 * Returns one of: "PAID" | "FAILED" | "EXPIRED" | "PENDING"
 */
async function fetchStatus(tracker) {
    // GET /order/v1/{tracker} is public for a tracker token and needs no secret.
    // (/reporter/api/v1/payments/{tracker} cannot find trackers made via
    //  /order/v1/init, even with the matching secret key.)
    const response = await axios.get(
        `${API_URL}/order/v1/${encodeURIComponent(tracker)}`,
        { timeout: 15000 }
    );

    const data = response.data?.data;
    const state = String(data?.state || data?.tracker?.state || "").toUpperCase();

    if (!state) {
        console.warn("Safepay: no tracker state found. Body was:",
            JSON.stringify(response.data));
    }

    const status = mapState(state);
    console.log(`Safepay tracker ${tracker} -> ${state || "(none)"} -> ${status}`);
    return status;
}

// https://safepay-docs.netlify.app/concepts/tracker-states
function mapState(state) {
    if (state === "TRACKER_ENDED") return "PAID";          // "The tracker has been paid"
    if (state === "TRACKER_CANCELLED") return "FAILED";    // customer cancelled the session
    if (state === "TRACKER_EXPIRED") return "EXPIRED";     // session can no longer be used
    // STARTED / ENROLLED / AUTHORIZED (still in progress) and anything else
    // (refund/dispute states are out of scope here) -> leave as pending.
    return "PENDING";
}

function buildCheckoutUrl({ tracker, orderId, baseUrl }) {
    const params = new URLSearchParams({
        env: ENV,
        beacon: tracker,
        source: "custom",
        order_id: orderId,
        redirect_url: process.env.SAFEPAY_REDIRECT_URL || `${baseUrl}/payments/success`,
        cancel_url: process.env.SAFEPAY_CANCEL_URL || `${baseUrl}/payments/cancel`
    });

    return `${API_URL}/checkout/pay?${params}`;
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a || ""));
    const y = Buffer.from(String(b || ""));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Webhook: HMAC-SHA512 of the RAW body, key = webhook shared secret.
function verifyWebhook(rawBody, signature) {
    const secret = process.env.SAFEPAY_WEBHOOK_SECRET;
    if (!secret || !rawBody) return false;

    const expected = crypto
        .createHmac("sha512", secret)
        .update(rawBody)
        .digest("hex");

    return safeEqual(expected, signature);
}

// Redirect: HMAC-SHA256 of the tracker, key = the SHARED (webhook) secret.
// Your old code used SAFEPAY_SECRET_KEY (the API key) here, which is a
// different secret, so this check could never match.
function verifyRedirect(tracker, sig) {
    const secret = process.env.SAFEPAY_WEBHOOK_SECRET;
    if (!secret || !tracker || !sig) return false;

    const expected = crypto
        .createHmac("sha256", secret)
        .update(tracker)
        .digest("hex");

    return safeEqual(expected, sig);
}

module.exports = {
    createTracker,
    fetchStatus,
    buildCheckoutUrl,
    verifyWebhook,
    verifyRedirect
};