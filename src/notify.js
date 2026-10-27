import crypto from 'node:crypto';
import { prisma } from './db.js';
import { sendMail } from './mailer.js';
import { clubEmail, customerEmail } from './templates.js';
import { newId, sleep } from './utils.js';

// Clubs are notified on three channels for every event:
//   1. dashboard — Server-Sent Events pushed to any open partner dashboard
//   2. email     — to the club's notification address
//   3. webhook   — signed JSON POST to the club's own system (POS, Slack bridge, etc.)
// Every attempt is written to the notifications log so clubs can audit delivery.

const streams = new Map(); // clubId -> Set<ServerResponse>
const RETRY_DELAYS_MS = [0, 2000, 8000];

export function subscribe(clubId, res) {
  if (!streams.has(clubId)) streams.set(clubId, new Set());
  streams.get(clubId).add(res);
  return () => streams.get(clubId)?.delete(res);
}

function pushToDashboards(clubId, event) {
  const open = streams.get(clubId);
  if (!open?.size) return 0;
  const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of open) res.write(frame);
  return open.size;
}

async function record(entry) {
  const n = { id: newId('ntf'), ...entry };
  try {
    await prisma.notification.create({ data: n });
  } catch (err) {
    console.error('Failed to log notification to database:', err.message);
  }
  pushToDashboards(entry.clubId, { type: 'notification.logged', data: n });
  return n;
}


export function signPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function deliverWebhook(club, event) {
  const body = JSON.stringify(event);
  let lastError = 'unknown error';
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (RETRY_DELAYS_MS[i]) await sleep(RETRY_DELAYS_MS[i]);
    const ts = Math.floor(Date.now() / 1000).toString();
    try {
      const res = await fetch(club.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Stara-Webhooks/1.0',
          'x-stara-event': event.type,
          'x-stara-delivery': event.id,
          'x-stara-timestamp': ts,
          'x-stara-signature': `sha256=${signPayload(club.webhookSecret, ts, body)}`,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return { status: 'delivered', attempts: i + 1, detail: `HTTP ${res.status} from ${club.webhookUrl}` };
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.name === 'TimeoutError' ? 'timed out after 8s' : err.cause?.code || err.message;
    }
  }
  return { status: 'failed', attempts: RETRY_DELAYS_MS.length, detail: `${lastError} (${club.webhookUrl})` };
}

export async function notifyClub(club, type, data, { channels = ['dashboard', 'email', 'webhook'] } = {}) {
  const event = { id: newId('evt'), type, createdAt: new Date().toISOString(), clubId: club.id, data };
  const base = { clubId: club.id, eventId: event.id, type, bookingRef: data?.ref ?? null };

  if (channels.includes('dashboard')) {
    const open = pushToDashboards(club.id, event);
    record({
      ...base,
      channel: 'dashboard',
      status: open ? 'delivered' : 'stored',
      attempts: 1,
      detail: open ? `Pushed live to ${open} open dashboard${open > 1 ? 's' : ''}` : 'No dashboard open — shown on next login',
    });
  }

  const jobs = [];
  const mail = channels.includes('email') && clubEmail(club, type, data);
  const to = club.notificationEmail || club.contact?.email;
  if (mail && to) {
    jobs.push(sendMail({ to, ...mail }).then((r) => record({ ...base, channel: 'email', attempts: 1, ...r })));
  }
  if (channels.includes('webhook') && club.webhookUrl) {
    jobs.push(deliverWebhook(club, event).then((r) => record({ ...base, channel: 'webhook', ...r })));
  }
  await Promise.allSettled(jobs);
  return event;
}

export function notifyCustomer(booking, kind) {
  return sendMail({ to: booking.customer.email, ...customerEmail(booking, kind) });
}

// Fire-and-forget helper for request handlers: never let a notification failure break a booking.
export function dispatch(promise) {
  promise.catch((err) => console.error('[notify] failed:', err));
}
