const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "123456",
    database: process.env.DB_NAME || "payment_api",
    waitForConnections: true,
    connectionLimit: 10
});

async function init() {
    const connection = await pool.getConnection();

    try {
        await connection.query("SELECT 1");
        console.log("MySQL connected successfully");
    } finally {
        connection.release();
    }
}

module.exports = {
    pool,
    init
};