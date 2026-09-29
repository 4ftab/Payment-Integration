const express = require("express");
const safepay = require("../services/safepayService");
const store = require("../models/paymentStore");

const router = express.Router();

const baseUrl = (req) =>
    process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;

// Turn any error (including Safepay's JSON error bodies) into plain text,
// so the frontend never shows "[object Object]".
function errText(error) {
    const d = error.response?.data ?? error.message;
    return typeof d === "string" ? d : JSON.stringify(d);
}

// Stops a double-click from creating two trackers at the same moment.
// (Fine for one Node process; use a DB lock if you ever run several.)
const inFlight = new Set();

/**
 * Ask Safepay about every still-pending attempt for this order.
 * - If ANY attempt was actually paid -> mark order paid (this also heals the
 *   old duplicate rows 7-13 for order 6).
 * - Otherwise return the newest attempt that is still usable, if any.
 */
async function reconcileOrder(orderId) {
    const pending = await store.listPendingByOrderId(orderId);
    let reusable = null;

    for (const payment of pending) {
        let status;
        try {
            status = await safepay.fetchStatus(payment.transaction_id);
        } catch (err) {
            // One bad/unknown tracker must not block the whole payment.
            console.warn(
                `Could not check tracker ${payment.transaction_id}:`,
                errText(err)
            );
            continue;
        }
        await store.applyStatus(payment, status);

        if (status === "PAID") return { paid: true, payment };
        if (status === "PENDING" && !reusable) reusable = payment;
    }

    return { paid: false, payment: reusable };
}

router.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

router.get("/orders", async (req, res) => {
    try {
        // Before showing the list, ask Safepay about any unfinished payments,
        // so a refresh picks up payments that just succeeded.
        const ids = await store.listOrderIdsWithPending();
        await Promise.all(
            ids.map((id) =>
                reconcileOrder(id).catch((err) =>
                    console.warn(`Reconcile failed for order ${id}:`, errText(err))
                )
            )
        );

        res.json(await store.listOrders());
    } catch (error) {
        console.error("Failed to load orders:", error);
        res.status(500).json({
            error: "Could not load orders",
            details: error.message
        });
    }
});

// ---------------------------------------------------------------
// Pay Now
// ---------------------------------------------------------------
router.post("/payments", async (req, res) => {
    const orderId = Number(req.body?.order_id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: "order_id is required" });
    }

    if (inFlight.has(orderId)) {
        return res.status(409).json({
            error: "A payment for this order is already being created"
        });
    }
    inFlight.add(orderId);

    try {
        const order = await store.getOrder(orderId);

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        if (String(order.Status).toLowerCase() === "paid") {
            return res.status(400).json({
                error: "This order is already paid",
                order_id: order.id,
                customer: order.customer_name
            });
        }

        // 1) Did an earlier attempt already succeed? Is one still usable?
        const { paid, payment: existing } = await reconcileOrder(order.id);

        if (paid) {
            return res.status(400).json({
                error: "This order is already paid",
                order_id: order.id,
                customer: order.customer_name
            });
        }

        // 2) Reuse the open tracker, or create one only if none is usable.
        let tracker;
        let reused = false;

        if (existing) {
            tracker = existing.transaction_id;
            reused = true;
        } else {
            tracker = await safepay.createTracker(Number(order.Amount), "PKR");
            await store.create({
                orderId: order.id,
                tracker,
                amount: order.Amount
            });
        }

        res.json({
            message: reused ? "Existing payment reused" : "Payment created",
            reused,
            order: {
                id: order.id,
                customer_id: order.Customer_Id,
                customer_name: order.customer_name,
                customer_email: order.customer_email,
                amount: Number(order.Amount),
                status: order.Status
            },
            tracker,
            checkoutUrl: safepay.buildCheckoutUrl({
                tracker,
                orderId: order.id,
                baseUrl: baseUrl(req)
            })
        });
    } catch (error) {
        console.error("Payment creation failed:", errText(error));
        res.status(502).json({
            error: "Could not create payment",
            details: errText(error)
        });
    } finally {
        inFlight.delete(orderId);
    }
});

// ---------------------------------------------------------------
// Customer comes back from Safepay.
// IMPORTANT: these two routes must be declared BEFORE "/payments/:orderId",
// otherwise Express treats the word "success" as an order id.
// ---------------------------------------------------------------
async function handleReturn(req, res) {
    // Safepay POSTs a form (tracker, sig, reference, order_id);
    // newer flows send ?tracker=... on a GET. Accept both.
    const data = { ...(req.query || {}), ...(req.body || {}) };

    console.log(
        `Safepay return: ${req.method}, fields = [${Object.keys(data).join(", ")}]`
    );

    try {
        let payment = null;

        if (data.tracker) {
            payment = await store.getByTracker(String(data.tracker));
        } else if (data.order_id) {
            payment = await store.getByOrderId(Number(data.order_id));
        }

        if (!payment) {
            return res.status(404).send("Payment not found");
        }

        // Nice-to-have integrity check. We do NOT depend on it, because the
        // real proof is asking Safepay directly below.
        if (data.sig && !safepay.verifyRedirect(String(data.tracker), String(data.sig))) {
            console.warn("Redirect signature did not match (check SAFEPAY_WEBHOOK_SECRET)");
        }

        // The browser can be lied to; Safepay's server cannot.
        const status = await safepay.fetchStatus(payment.transaction_id);
        await store.applyStatus(payment, status);

        // 303 = "now do a normal GET", which is what we want after a form POST.
        res.redirect(
            303,
            `/?order=${encodeURIComponent(payment.order_id)}&payment=${status}`
        );
    } catch (error) {
        console.error(
            "Payment verification failed:",
            error.response?.data || error.message
        );
        res.status(500).send("Could not verify payment");
    }
}

router.get("/payments/success", handleReturn);
router.post("/payments/success", handleReturn);

function handleCancel(req, res) {
    res.redirect(303, "/?cancelled=1");
}
router.get("/payments/cancel", handleCancel);
router.post("/payments/cancel", handleCancel);

// Manual "refresh status" for one order (Postman / a Refresh button).
router.get("/payments/:orderId", async (req, res) => {
    const orderId = Number(req.params.orderId);

    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: "Invalid order id" });
    }

    try {
        const latest = await store.getByOrderId(orderId);

        if (!latest) {
            return res.status(404).json({ error: "Payment not found" });
        }

        await reconcileOrder(orderId);

        res.json(await store.getByOrderId(orderId));
    } catch (error) {
        console.error(
            "Payment status check failed:",
            error.response?.data || error.message
        );
        res.status(500).json({
            error: "Could not check payment status",
            details: errText(error)
        });
    }
});

// ---------------------------------------------------------------
// Webhook: Safepay's server calls this (needs a PUBLIC url, see notes).
// We treat it as a doorbell: it tells us WHICH tracker to look at, then we
// ask Safepay for the truth. A "failed" attempt is not final (the customer
// can retry on the same tracker), so we never trust a webhook to say FAILED.
// ---------------------------------------------------------------
router.post("/webhooks/safepay", async (req, res) => {
    if (!safepay.verifyWebhook(req.rawBody, req.get("X-SFPY-SIGNATURE"))) {
        return res.status(401).json({ error: "Invalid signature" });
    }

    try {
        const body = req.body || {};
        const notification =
            body.notification || body.data?.notification || body.data || {};
        const tracker = notification.tracker;

        if (tracker) {
            const payment = await store.getByTracker(String(tracker));

            if (payment) {
                const status = await safepay.fetchStatus(payment.transaction_id);
                await store.applyStatus(payment, status);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook handling failed:", error.message);
        res.sendStatus(500); // non-2xx => Safepay will retry later
    }
});

module.exports = router;