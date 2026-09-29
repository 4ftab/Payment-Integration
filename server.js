require("dotenv").config();

const path = require("path");
const express = require("express");
const store = require("./models/paymentStore");
const paymentRoutes = require("./routes/paymentroutes");

const app = express();

// JSON bodies (your frontend + Postman). We also keep the raw bytes,
// because Safepay webhook signatures are computed over the raw body.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// NEW: after a successful payment Safepay sends the customer back to
// /payments/success with an HTML *form POST* (application/x-www-form-urlencoded).
// Without this line, req.body would be empty and tracker/sig would be lost.
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, "public")));

app.use("/", paymentRoutes);

app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: "Request failed" });
});

const PORT = process.env.PORT || 5000;

store.init()
    .then(() => {
        app.listen(PORT, () => console.log("Server running on port " + PORT));
    })
    .catch((err) => {
        console.error("Startup failed:", err.message);
        process.exit(1);
    });