require("dotenv").config();

const express = require("express");
const store = require("./models/paymentStore");
const paymentRoutes = require("./routes/paymentroutes");

const app = express();

// Keep the raw body: webhook signatures are computed over it.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.use(express.static(require("path").join(__dirname, "public")));

app.use("/", paymentRoutes);

app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: "Request failed" });
});

const PORT = process.env.PORT || 5000;

store.init().then(() => {
    app.listen(PORT, () => console.log("Server running on port " + PORT));
});
