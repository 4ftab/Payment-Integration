const db = require("../config/db");

async function init() {
    await db.init();
}

async function listOrders() {
    const [rows] = await db.pool.query(`
        SELECT
            o.id AS order_id,
            o.Customer_Id,
            c.Name AS customer_name,
            c.Email AS customer_email,
            o.Amount,
            o.Status,
            o.Created_At
        FROM orders o
        INNER JOIN customers c ON o.Customer_Id = c.Id
        ORDER BY o.id DESC
    `);
    return rows;
}

async function getOrder(orderId) {
    const [rows] = await db.pool.query(`
        SELECT
            o.id,
            o.Customer_Id,
            c.Name AS customer_name,
            c.Email AS customer_email,
            o.Amount,
            o.Status,
            o.Created_At
        FROM orders o
        INNER JOIN customers c ON o.Customer_Id = c.Id
        WHERE o.id = ?
        LIMIT 1
    `, [orderId]);
    return rows[0] || null;
}

async function create({ orderId, tracker, amount }) {
    const [result] = await db.pool.query(`
        INSERT INTO payments (order_id, amount, transaction_id, status, gateway)
        VALUES (?, ?, ?, 'PENDING', 'safepay')
    `, [orderId, amount, tracker]);
    return result;
}

async function getByOrderId(orderId) {
    const [rows] = await db.pool.query(
        `SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
        [orderId]
    );
    return rows[0] || null;
}

// All still-pending payment attempts for an order, newest first.
async function listPendingByOrderId(orderId) {
    const [rows] = await db.pool.query(
        `SELECT * FROM payments
         WHERE order_id = ? AND status = 'PENDING'
         ORDER BY id DESC`,
        [orderId]
    );
    return rows;
}

// Orders that are not paid yet but have a payment attempt in progress.
async function listOrderIdsWithPending() {
    const [rows] = await db.pool.query(`
        SELECT DISTINCT p.order_id
        FROM payments p
        INNER JOIN orders o ON o.id = p.order_id
        WHERE p.status = 'PENDING' AND LOWER(o.Status) <> 'paid'
    `);
    return rows.map((r) => r.order_id);
}

async function getByTracker(tracker) {
    const [rows] = await db.pool.query(
        `SELECT * FROM payments WHERE transaction_id = ? LIMIT 1`,
        [tracker]
    );
    return rows[0] || null;
}

async function list(limit = 20) {
    const [rows] = await db.pool.query(
        `SELECT * FROM payments ORDER BY id DESC LIMIT ?`,
        [Number(limit)]
    );
    return rows;
}

/**
 * Payment succeeded: update payment + order together, or not at all.
 * Also retires any other pending attempts for the same order.
 */
async function markPaid(payment) {
    const conn = await db.pool.getConnection();
    try {
        await conn.beginTransaction();

        await conn.query(
            `UPDATE payments SET status = 'PAID' WHERE id = ?`,
            [payment.id]
        );
        await conn.query(
            `UPDATE orders SET Status = 'Paid' WHERE id = ?`,
            [payment.order_id]
        );
        await conn.query(
            `UPDATE payments SET status = 'EXPIRED'
             WHERE order_id = ? AND id <> ? AND status = 'PENDING'`,
            [payment.order_id, payment.id]
        );

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Apply a status we got FROM SAFEPAY to ONE payment row (by id, not by order).
 * - PAID    -> payment + order become paid (transaction)
 * - FAILED / EXPIRED -> only a still-PENDING row changes; a PAID row is never downgraded
 * - PENDING -> nothing to do
 * The order stays 'Pending' after a failure so the customer can pay again.
 */
async function applyStatus(payment, status) {
    if (status === "PAID") {
        return markPaid(payment);
    }

    if (status === "FAILED" || status === "EXPIRED") {
        await db.pool.query(
            `UPDATE payments SET status = ? WHERE id = ? AND status = 'PENDING'`,
            [status, payment.id]
        );
    }
}

module.exports = {
    init,
    listOrders,
    getOrder,
    create,
    getByOrderId,
    listPendingByOrderId,
    listOrderIdsWithPending,
    getByTracker,
    list,
    applyStatus
};