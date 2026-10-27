import nodemailer from 'nodemailer';

// Real email when SMTP_* env vars are set; otherwise messages are printed to the console
// so the whole flow can be followed locally without an email provider.
let transport;

function getTransport() {
  if (transport !== undefined) return transport;
  transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    : null;
  return transport;
}

export async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (!t) {
    const body = text.split('\n').map((l) => `   │ ${l}`).join('\n');
    console.log(`\n✉  [email → ${to}] ${subject}\n${body}\n`);
    return { status: 'logged', detail: `SMTP not configured — printed to server console for ${to}` };
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || 'Stara <no-reply@stara.lk>', to, subject, text });
    return { status: 'delivered', detail: `Sent to ${to}` };
  } catch (err) {
    return { status: 'failed', detail: err.message };
  }
}
