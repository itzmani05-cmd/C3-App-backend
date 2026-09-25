const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { isKnownNotificationType } = require('./notificationTypes');
const { sendExpoPushNotifications, getExpoPushReceipts, isExpoPushToken } = require('../utils/expoPush');

const LOCK_MS = 2 * 60 * 1000;
const MAX_PUSH_ATTEMPTS = 5;
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 500;
const BULK_CHUNK = 500;

const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidToken']);
const RETRYABLE_ERRORS = new Set(['TransportError', 'MessageRateExceeded']);

const STUDENT_ROLES = ['student', 'Student'];

function toIdString(v) {
  return v == null ? '' : String(v);
}

function buildPushData(doc) {
  const data = {};
  Object.entries(doc.data || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) data[k] = typeof v === 'object' && !Array.isArray(v) ? toIdString(v) : v;
  });
  data.type = doc.type;
  data.notificationId = toIdString(doc._id);
  if (doc.dailyChallengeId) data.dailyChallengeId = toIdString(doc.dailyChallengeId);
  return data;
}

function validateInput({ userId, type, title, body }) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return 'invalid userId';
  if (!isKnownNotificationType(type)) return `unknown notification type "${type}" — register it in services/notificationTypes.js`;
  if (typeof title !== 'string' || !title.trim()) return 'title is required';
  if (typeof body !== 'string' || !body.trim()) return 'body is required';
  return null;
}

function buildDoc({ _id, userId, type, title, body, data, dedupeKey, dailyChallengeId }, now) {
  const doc = {
    _id: _id || new mongoose.Types.ObjectId(),
    userId,
    type,
    title: title.trim(),
    message: body.trim(),
    read: false,
    createdAt: now,
    push: { status: 'pending', attempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) },
  };
  if (data && Object.keys(data).length) doc.data = data;
  if (dedupeKey) doc.dedupeKey = String(dedupeKey);
  if (dailyChallengeId) doc.dailyChallengeId = dailyChallengeId;
  return doc;
}

async function clearDeadToken(userId, token) {
  await User.updateOne({ _id: userId, expoPushToken: token }, { $unset: { expoPushToken: 1 } });
}

async function deliverPushes(docs, tokenByUserId) {
  if (!docs.length) return;

  let tokens = tokenByUserId;
  const missing = docs.filter((d) => !tokens || !tokens.has(toIdString(d.userId))).map((d) => d.userId);
  if (missing.length) {
    tokens = new Map(tokens || []);
    const users = await User.find({ _id: { $in: missing } }).select('expoPushToken').lean();
    users.forEach((u) => tokens.set(toIdString(u._id), u.expoPushToken || null));
  }

  const now = new Date();
  const updates = [];
  const sendable = [];

  docs.forEach((doc) => {
    const token = tokens.get(toIdString(doc.userId));
    if (!isExpoPushToken(token)) {
      updates.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { 'push.status': 'skipped', 'push.error': token ? 'invalid_token' : 'no_token' }, $unset: { 'push.lockedUntil': 1 } },
        },
      });
      return;
    }
    sendable.push({ doc, token });
  });

  const tickets = await sendExpoPushNotifications(
    sendable.map(({ doc, token }) => ({ to: token, title: doc.title, body: doc.message, data: buildPushData(doc) }))
  );

  const deadTokens = [];
  sendable.forEach(({ doc, token }, i) => {
    const ticket = tickets[i] || {};
    const attempts = (doc.push?.attempts || 0) + 1;
    let set;
    const unset = { 'push.lockedUntil': 1 };

    if (ticket.status === 'ok') {
      set = { 'push.status': 'sent', 'push.ticketId': ticket.id, 'push.sentAt': now, 'push.to': token };
      unset['push.error'] = 1;
    } else {
      const code = ticket.details?.error || 'UnknownError';
      const retry = RETRYABLE_ERRORS.has(code) && attempts < MAX_PUSH_ATTEMPTS;
      set = { 'push.status': retry ? 'pending' : 'failed', 'push.error': `${code}: ${ticket.message || ''}`.slice(0, 300) };
      if (DEAD_TOKEN_ERRORS.has(code)) deadTokens.push({ userId: doc.userId, token });
      if (!retry) console.error('[notification.service] push failed', toIdString(doc._id), code, ticket.message || '');
    }

    updates.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { ...set, 'push.attempts': attempts }, $unset: unset },
      },
    });
  });

  if (updates.length) await Notification.bulkWrite(updates, { ordered: false });
  await Promise.all(deadTokens.map(({ userId, token }) => clearDeadToken(userId, token)));
}

async function sendNotification(p) {
  const invalid = validateInput(p);
  if (invalid) {
    console.error('[notification.service] rejected:', invalid);
    return { created: false, error: invalid };
  }

  const doc = buildDoc(p, new Date());

  let stored = true;
  try {
    await Notification.create(doc);
  } catch (err) {
    if (err.code === 11000) return { created: false, duplicate: true };
    stored = false;
    console.error('[notification.service] could not store notification:', err.message);
  }

  try {
    const tokens = p.pushToken !== undefined ? new Map([[toIdString(p.userId), p.pushToken]]) : undefined;
    if (stored) {
      await deliverPushes([doc], tokens);
    } else {
      const token = tokens?.get(toIdString(p.userId)) ?? (await User.findById(p.userId).select('expoPushToken').lean())?.expoPushToken;
      if (isExpoPushToken(token)) {
        await sendExpoPushNotifications([{ to: token, title: doc.title, body: doc.message, data: buildPushData(doc) }]);
      }
    }
  } catch (err) {
    console.error('[notification.service] push step failed:', err.message);
  }

  return { created: stored, notificationId: toIdString(doc._id) };
}

async function sendNotificationToMany({ userIds, ...rest }) {
  const ids = [...new Set((userIds || []).map(toIdString))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const invalid = validateInput({ ...rest, userId: ids[0] });
  if (!ids.length || invalid) {
    if (invalid && ids.length) console.error('[notification.service] rejected broadcast:', invalid);
    return { created: 0, duplicates: 0 };
  }

  let created = 0;
  let duplicates = 0;

  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const now = new Date();
    const docs = ids.slice(i, i + BULK_CHUNK).map((userId) => buildDoc({ ...rest, userId }, now));

    try {
      await Notification.insertMany(docs, { ordered: false });
    } catch (err) {
      const nonDup = (err.writeErrors || []).some((e) => (e.code ?? e.err?.code) !== 11000);
      if (nonDup || !err.writeErrors) console.error('[notification.service] broadcast insert error:', err.message);
    }

    const insertedIds = new Set(
      (await Notification.find({ _id: { $in: docs.map((d) => d._id) } }).select('_id').lean()).map((d) => toIdString(d._id))
    );
    const inserted = docs.filter((d) => insertedIds.has(toIdString(d._id)));
    created += inserted.length;
    duplicates += docs.length - inserted.length;

    try {
      await deliverPushes(inserted);
    } catch (err) {
      console.error('[notification.service] broadcast push step failed:', err.message);
    }
  }

  return { created, duplicates };
}

async function findStudentIds({ examId } = {}) {
  const filter = {
    role: { $in: STUDENT_ROLES },
    isActive: { $ne: false },
    status: { $nin: ['inactive', 'blocked'] },
  };
  if (examId) filter.examIds = examId;
  const users = await User.find(filter).select('_id').lean();
  return users.map((u) => u._id);
}

async function runPushOutboxSweep() {
  const now = new Date();
  const candidates = await Notification.find({
    'push.status': 'pending',
    createdAt: { $gte: new Date(now.getTime() - OUTBOX_MAX_AGE_MS) },
    $or: [{ 'push.lockedUntil': { $exists: false } }, { 'push.lockedUntil': { $lte: now } }],
  })
    .sort({ createdAt: 1 })
    .limit(SWEEP_BATCH)
    .lean();

  const claimed = [];
  for (const doc of candidates) {
    const res = await Notification.updateOne(
      {
        _id: doc._id,
        'push.status': 'pending',
        $or: [{ 'push.lockedUntil': { $exists: false } }, { 'push.lockedUntil': { $lte: now } }],
      },
      { $set: { 'push.lockedUntil': new Date(Date.now() + LOCK_MS) } }
    );
    if (res.modifiedCount === 1) claimed.push(doc);
  }

  await deliverPushes(claimed);

  await Notification.updateMany(
    { 'push.status': 'pending', createdAt: { $lt: new Date(now.getTime() - OUTBOX_MAX_AGE_MS) } },
    { $set: { 'push.status': 'failed', 'push.error': 'expired_in_outbox' }, $unset: { 'push.lockedUntil': 1 } }
  );

  return { retried: claimed.length };
}

async function runPushReceiptSweep() {
  const now = Date.now();
  const sent = await Notification.find({
    'push.status': 'sent',
    'push.ticketId': { $exists: true },
    'push.sentAt': { $lte: new Date(now - RECEIPT_DELAY_MS), $gte: new Date(now - RECEIPT_MAX_AGE_MS) },
  })
    .select('_id userId push')
    .limit(SWEEP_BATCH * 2)
    .lean();
  if (!sent.length) return { checked: 0 };

  const receipts = await getExpoPushReceipts(sent.map((n) => n.push.ticketId));
  const updates = [];
  const deadTokens = [];

  sent.forEach((n) => {
    const receipt = receipts.get(n.push.ticketId);
    if (!receipt) return;
    if (receipt.status === 'ok') {
      updates.push({ updateOne: { filter: { _id: n._id }, update: { $set: { 'push.status': 'delivered', 'push.receiptCheckedAt': new Date() } } } });
      return;
    }
    const code = receipt.details?.error || 'UnknownError';
    updates.push({
      updateOne: {
        filter: { _id: n._id },
        update: { $set: { 'push.status': 'failed', 'push.error': `${code}: ${receipt.message || ''}`.slice(0, 300), 'push.receiptCheckedAt': new Date() } },
      },
    });
    if (DEAD_TOKEN_ERRORS.has(code) && n.push.to) deadTokens.push({ userId: n.userId, token: n.push.to });
    else console.error('[notification.service] push receipt error', toIdString(n._id), code, receipt.message || '');
  });

  if (updates.length) await Notification.bulkWrite(updates, { ordered: false });
  await Promise.all(deadTokens.map(({ userId, token }) => clearDeadToken(userId, token)));

  return { checked: updates.length, removedTokens: deadTokens.length };
}

module.exports = {
  sendNotification,
  sendNotificationToMany,
  findStudentIds,
  runPushOutboxSweep,
  runPushReceiptSweep,
};
