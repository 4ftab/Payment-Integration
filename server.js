require("dotenv").config();

console.log(
    "Safepay public key loaded:",
    !!process.env.SAFEPAY_PUBLIC_KEY
);


const express = require("express");
const db = require("./config/db");

const paymentRoutes = require("./routes/paymentroutes");

const app = express();

app.use(express.json());

app.use("/", paymentRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "Payment API is running"
    });
});

app.listen(5000, () => {
    console.log("Server running on port 5000");
});