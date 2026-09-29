const mysql = require("mysql2/promise");

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
};

const pool = mysql.createPool({
    ...dbConfig,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL UNIQUE,
    tracker VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(8) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (tracker)
)`;

// Creates the database/table if needed. Resolves true when MySQL is usable.
async function init() {
    try {
        const conn = await mysql.createConnection(dbConfig);
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
        await conn.end();
        await pool.query(SCHEMA);
        console.log("Database connected, payments table ready");
        return true;
    } catch (err) {
        console.warn(`Database unavailable (${err.code || err.message}); using in-memory payment store`);
        return false;
    }
}

module.exports = pool;
module.exports.init = init;
