const db = require("../config/db");

// MySQL-backed store with an in-memory fallback (data is lost on restart).
const memory = new Map();
let useMysql = false;

async function init() {
    useMysql = await db.init();
}

async function create({ orderId, tracker, amount, currency }) {
    if (useMysql) {
        await db.query(
            "INSERT INTO payments (order_id, tracker, amount, currency) VALUES (?, ?, ?, ?)",
            [orderId, tracker, amount, currency]
        );
    } else {
        memory.set(orderId, { order_id: orderId, tracker, amount, currency, status: "PENDING" });
    }
}

async function getByOrderId(orderId) {
    if (useMysql) {
        const [rows] = await db.query("SELECT * FROM payments WHERE order_id = ?", [orderId]);
        return rows[0] || null;
    }
    return memory.get(orderId) || null;
}

async function getByTracker(tracker) {
    if (useMysql) {
        const [rows] = await db.query("SELECT * FROM payments WHERE tracker = ?", [tracker]);
        return rows[0] || null;
    }
    return [...memory.values()].find((p) => p.tracker === tracker) || null;
}

async function list(limit = 20) {
    if (useMysql) {
        const [rows] = await db.query("SELECT * FROM payments ORDER BY id DESC LIMIT ?", [limit]);
        return rows;
    }
    return [...memory.values()].reverse().slice(0, limit);
}

async function updateStatus(orderId, status) {
    if (useMysql) {
        await db.query("UPDATE payments SET status = ? WHERE order_id = ?", [status, orderId]);
    } else if (memory.has(orderId)) {
        memory.get(orderId).status = status;
    }
}

module.exports = { init, create, getByOrderId, getByTracker, list, updateStatus };
