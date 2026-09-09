require("dotenv").config({ path: ".env.local" });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTestMessage() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Error: TELEGRAM_BOT_TOKEN ya TELEGRAM_CHAT_ID .env.local mein missing hai");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const message = "✅ Test successful! Odisha Tenders bot sahi kaam kar raha hai.";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log("✅ Message successfully bhej diya gaya! Apna Telegram check karo.");
    } else {
      console.error("❌ Telegram ne error diya:", data.description);
    }
  } catch (err) {
    console.error("❌ Kuch galat hua:", err.message);
  }
}

sendTestMessage();