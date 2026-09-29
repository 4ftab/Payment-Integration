require("dotenv").config();

const generateSafepayToken = require("./services/safepayAuthService");

async function test() {
    try {
        const token = await generateSafepayToken();

        console.log("Token generated:");
        console.log(token);

    } catch (error) {
        console.log("Authentication test failed.");
    }
}

test();