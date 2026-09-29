const axios = require("axios");
require("dotenv").config();

async function loginSafepay() {

    try {

        const response = await axios.post(
            "https://sandbox.api.getsafepay.com/auth/v1/company/login",
            {
                email: process.env.SAFEPAY_ADMIN_EMAIL,
                password: process.env.SAFEPAY_ADMIN_PASSWORD
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("Safepay login response:");
        console.log(response.data);

    } catch (error) {

        console.log(
            "Safepay login error:",
            error.response?.data || error.message
        );

    }
}

loginSafepay();