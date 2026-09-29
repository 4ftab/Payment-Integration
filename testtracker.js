// Usage:  node testTracker.js track_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
// Prints what Safepay says about one tracker, using each secret in your .env.
require("dotenv").config();
const axios = require("axios");

const tracker = process.argv[2];
if (!tracker) {
    console.log("Give a tracker:  node testTracker.js track_...");
    process.exit(1);
}

const ENV = process.env.SAFEPAY_ENV === "production" ? "production" : "sandbox";
const API = ENV === "production"
    ? "https://api.getsafepay.com"
    : "https://sandbox.api.getsafepay.com";

const mask = (v) => (v ? `${v.slice(0, 4)}...${v.slice(-4)} (len ${v.length})` : "NOT SET");

console.log("Environment        :", ENV);
console.log("SAFEPAY_PUBLIC_KEY :", mask(process.env.SAFEPAY_PUBLIC_KEY));
console.log("SAFEPAY_SECRET_KEY :", mask(process.env.SAFEPAY_SECRET_KEY));
console.log("SAFEPAY_WEBHOOK_SECRET:", mask(process.env.SAFEPAY_WEBHOOK_SECRET));
console.log("");

(async () => {
    const url = `${API}/reporter/api/v1/payments/${tracker}`;

    for (const name of ["SAFEPAY_SECRET_KEY", "SAFEPAY_WEBHOOK_SECRET", "SAFEPAY_PUBLIC_KEY"]) {
        const value = process.env[name];
        if (!value) continue;

        try {
            const r = await axios.get(url, {
                headers: { "X-SFPY-MERCHANT-SECRET": value },
                timeout: 15000
            });
            const d = r.data?.data;
            console.log(`[${name}] OK -> state:`, d?.tracker?.state || d?.state || "(not found)");
        } catch (e) {
            const d = e.response?.data ?? e.message;
            console.log(`[${name}] FAILED ->`, typeof d === "string" ? d : JSON.stringify(d));
        }
    }
})();