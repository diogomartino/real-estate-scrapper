const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

class Notifier {
  public sendTelegramNotification = async (text: string) => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
        }),
      },
    );

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Telegram error: ${JSON.stringify(data)}`);
    }

    return data;
  };
}

const notifier = new Notifier();

export { notifier };
