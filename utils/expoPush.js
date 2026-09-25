const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const SEND_CHUNK_SIZE = 100;
const RECEIPT_CHUNK_SIZE = 1000;

const ANDROID_CHANNEL_ID = 'alerts';

function isExpoPushToken(token) {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

function buildHeaders() {
  const headers = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return headers;
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: buildHeaders(), body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
  }
  if (!res.ok) {
    const detail = json?.errors?.[0]?.message || text.slice(0, 300);
    throw new Error(`Expo push request failed (${res.status}): ${detail}`);
  }
  return json;
}

async function sendExpoPushNotifications(messages) {
  const list = messages || [];
  const tickets = new Array(list.length);

  const validIdx = [];
  list.forEach((m, i) => {
    if (isExpoPushToken(m?.to)) validIdx.push(i);
    else tickets[i] = { status: 'error', message: 'Invalid Expo push token', details: { error: 'InvalidToken' } };
  });

  for (let i = 0; i < validIdx.length; i += SEND_CHUNK_SIZE) {
    const chunkIdx = validIdx.slice(i, i + SEND_CHUNK_SIZE);
    const payload = chunkIdx.map((idx) => {
      const m = list[idx];
      return {
        to: m.to,
        title: m.title,
        body: m.body,
        data: m.data || {},
        sound: 'default',
        priority: 'high',
        channelId: ANDROID_CHANNEL_ID,
      };
    });

    try {
      const json = await postJson(EXPO_PUSH_URL, payload);
      const data = Array.isArray(json?.data) ? json.data : [];
      chunkIdx.forEach((idx, j) => {
        tickets[idx] = data[j] || { status: 'error', message: 'Missing ticket in Expo response', details: {} };
      });
    } catch (err) {
      console.error('[expoPush] send error:', err.message);
      chunkIdx.forEach((idx) => {
        tickets[idx] = { status: 'error', message: err.message, details: { error: 'TransportError' } };
      });
    }
  }

  return tickets;
}

async function getExpoPushReceipts(ticketIds) {
  const receipts = new Map();
  const ids = [...new Set((ticketIds || []).filter(Boolean))];

  for (let i = 0; i < ids.length; i += RECEIPT_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + RECEIPT_CHUNK_SIZE);
    try {
      const json = await postJson(EXPO_RECEIPTS_URL, { ids: chunk });
      Object.entries(json?.data || {}).forEach(([id, receipt]) => receipts.set(id, receipt));
    } catch (err) {
      console.error('[expoPush] receipt lookup error:', err.message);
    }
  }

  return receipts;
}

module.exports = { sendExpoPushNotifications, getExpoPushReceipts, isExpoPushToken };
