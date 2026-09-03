const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100; // Expo's per-request limit

function isExpoPushToken(token) {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

// messages: [{ to, title, body, data }]. Silently skips/logs failures — a push reminder
// is a nice-to-have, never something that should take down the caller.
async function sendExpoPushNotifications(messages) {
  const valid = (messages || []).filter((m) => isExpoPushToken(m?.to));
  if (!valid.length) return;

  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk.map((m) => ({
          to: m.to,
          title: m.title,
          body: m.body,
          data: m.data || {},
          sound: 'default',
        }))),
      });
      if (!res.ok) {
        console.error('[expoPush] Push send failed with status', res.status, await res.text());
      }
    } catch (err) {
      console.error('[expoPush] Push send error:', err.message);
    }
  }
}

module.exports = { sendExpoPushNotifications, isExpoPushToken };
