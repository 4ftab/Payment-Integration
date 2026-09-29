const express = require("express");
const crypto = require("crypto");
const safepay = require("../services/safepayService");
const store = require("../models/paymentStore");

const router = express.Router();

const CURRENCIES = ["PKR", "USD"];
const baseUrl = (req) => process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;

// Syncs a pending payment with Safepay and returns the up-to-date record.
async function refresh(payment) {
    if (payment.status !== "PENDING") return payment;
    try {
        const status = await safepay.fetchStatus(payment.tracker);
        if (status !== payment.status) {
            await store.updateStatus(payment.order_id, status);
            payment.status = status;
        }
    } catch (error) {
        console.error("status check failed:", error.response?.data || error.message);
    }
    return payment;
}

router.get("/health", (req, res) => res.json({ status: "ok" }));

async function createPayment(req, res) {
    const { amount, currency = "PKR" } = req.body || {};
    if (typeof amount !== "number" || !(amount > 0)) {
        return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (!CURRENCIES.includes(currency)) {
        return res.status(400).json({ error: `currency must be one of ${CURRENCIES.join(", ")}` });
    }
    try {
        const orderId = crypto.randomUUID();
        const tracker = await safepay.createTracker(amount, currency);
        await store.create({ orderId, tracker, amount, currency });
        res.status(201).json({
            orderId,
            tracker,
            checkoutUrl: safepay.buildCheckoutUrl({ tracker, orderId, baseUrl: baseUrl(req) })
        });
    } catch (error) {
        console.error("create-payment failed:", error.response?.data || error.message);
        res.status(502).json({ error: "Could not create payment" });
    }
}
router.post("/payments", createPayment);
router.post("/create-payment", createPayment);

const toJson = (p) => ({
    orderId: p.order_id,
    amount: Number(p.amount),
    currency: p.currency,
    status: p.status
});

router.get("/payments", async (req, res) => {
    const payments = await store.list();
    await Promise.all(payments.map(refresh));
    res.json(payments.map(toJson));
});

router.get("/payments/success", async (req, res) => {
    const payment = req.query.order_id && await store.getByOrderId(req.query.order_id);
    if (!payment) return res.status(400).send("Unknown payment");
    // Status comes from Safepay server-side, not from the redirect query.
    await refresh(payment);
    res.redirect(`/?order=${payment.order_id}`);
});

router.get("/payments/cancel", (req, res) => res.redirect("/?cancelled=1"));

router.get("/payments/:orderId", async (req, res) => {
    const payment = await store.getByOrderId(req.params.orderId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    await refresh(payment);
    res.json(toJson(payment));
});

router.post("/webhooks/safepay", async (req, res) => {
    if (!safepay.verifyWebhook(req.rawBody, req.get("X-SFPY-SIGNATURE"))) {
        return res.status(401).json({ error: "Invalid signature" });
    }
    const n = req.body?.data?.notification || {};
    const payment = n.tracker && await store.getByTracker(n.tracker);
    if (payment) {
        const status = String(n.state || "").toUpperCase() === "PAID" ? "PAID" : "FAILED";
        if (payment.status !== "PAID") await store.updateStatus(payment.order_id, status);
    }
    res.sendStatus(200);
});

module.exports = router;
