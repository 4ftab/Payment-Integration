const { createTracker } = require("./safepayService");

// Kept for testSafepayAuth.js.
module.exports = (amount = 1, currency = "PKR") => createTracker(amount, currency);
