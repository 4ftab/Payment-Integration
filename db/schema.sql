-- ============================================
-- PAYMENT INTEGRATION DATABASE
-- Run once:  mysql -u root -p < db/schema.sql
-- ============================================

CREATE DATABASE IF NOT EXISTS payment_api;
USE payment_api;


-- ============================================
-- CUSTOMERS
-- ============================================

CREATE TABLE IF NOT EXISTS customers (
    Id INT NOT NULL AUTO_INCREMENT,
    Name VARCHAR(255) DEFAULT NULL,
    Email VARCHAR(255) DEFAULT NULL,

    PRIMARY KEY (Id)
);


-- ============================================
-- ORDERS
-- ============================================

CREATE TABLE IF NOT EXISTS orders (
    id INT NOT NULL AUTO_INCREMENT,
    Customer_Id INT NOT NULL,
    Amount DECIMAL(10,2) NOT NULL,
    Status VARCHAR(20) DEFAULT 'Pending',
    Created_At TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY Customer_Id (Customer_Id),

    CONSTRAINT orders_ibfk_1
        FOREIGN KEY (Customer_Id)
        REFERENCES customers (Id)
);


-- ============================================
-- PAYMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS payments (
    id INT NOT NULL AUTO_INCREMENT,
    order_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    transaction_id VARCHAR(100) DEFAULT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    gateway VARCHAR(30) NOT NULL DEFAULT 'jazzcash',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY order_id (order_id),

    CONSTRAINT payments_ibfk_1
        FOREIGN KEY (order_id)
        REFERENCES orders (id)
);


-- ============================================
-- SAMPLE DATA (run only on an empty database)
-- ============================================

INSERT INTO customers
    (Name, Email)
VALUES
    ('Zubair', 'zubair@gmail.com'),
    ('Ali', 'ali@gmail.com'),
    ('Ahmed', 'ahmed@gmail.com'),
    ('Bilal', 'bilal@gmail.com');

INSERT INTO orders
    (Customer_Id, Amount, Status)
VALUES
    (1, 6000.00, 'Paid'),
    (1, 3000.00, 'Paid'),
    (1, 9000.00, 'Paid'),
    (1, 10000.00, 'Pending'),
    (1, 9000.00, 'Paid');

INSERT INTO payments
    (order_id, amount, transaction_id, status, gateway)
VALUES
    (1, 5000.00, NULL, 'success', 'jazzcash'),
    (1, 5000.00, 'TXN_1790573692181', 'success', 'jazzcash'),
    (2, 3000.00, 'EP_1790575272548', 'success', 'easypaisa'),
    (3, 6000.00, 'ST_1790575364142', 'success', 'stripe'),
    (4, 3000.00, 'SP_1790663496614', 'success', 'safepay'),
    (5, 9000.00, 'ST_179063954148', 'success', 'stripe');
