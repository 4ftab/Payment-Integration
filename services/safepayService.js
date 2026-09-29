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
let workingSecretName = null;

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
    const url = `${API_URL}/reporter/api/v1/payments/${encodeURIComponent(tracker)}`;

    // This endpoint requires a secret in the X-SFPY-MERCHANT-SECRET header.
    // Safepay's error text calls it the "merchant webhook secret", but its docs
    // say "secret key", so we try both of your secrets and remember the winner.
    const candidates = [
        ["SAFEPAY_WEBHOOK_SECRET", process.env.SAFEPAY_WEBHOOK_SECRET],
        ["SAFEPAY_SECRET_KEY", process.env.SAFEPAY_SECRET_KEY]
    ].filter(([, value]) => value);

    if (workingSecretName) {
        candidates.sort((a) => (a[0] === workingSecretName ? -1 : 1));
    }

    let response;
    const failures = [];

    for (const [name, value] of candidates) {
        try {
            response = await axios.get(url, {
                headers: { "X-SFPY-MERCHANT-SECRET": value },
                timeout: 15000
            });
            if (workingSecretName !== name) {
                workingSecretName = name;
                console.log(`Safepay accepted ${name} for tracker lookups`);
            }
            break;
        } catch (err) {
            const d = err.response?.data ?? err.message;
            failures.push(`${name}: ${typeof d === "string" ? d : JSON.stringify(d)}`);
        }
    }

    if (!response) {
        throw new Error(
            candidates.length
                ? "Safepay rejected every secret. " + failures.join(" | ")
                : "Neither SAFEPAY_WEBHOOK_SECRET nor SAFEPAY_SECRET_KEY is set in .env"
        );
    }

    // The docs show the state at data.tracker.state in one place and
    // data.state in another, so we accept both.
    const data = response.data?.data;
    const state = String(data?.tracker?.state || data?.state || "").toUpperCase();

    if (!state) {
        // Unknown shape: print it once so you can see what Safepay really sent.
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