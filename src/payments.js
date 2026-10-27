import crypto from 'node:crypto';

// Payment gateway seam. The demo approves every online payment; replace the body of
// chargeOnline with a real provider (PayHere, Stripe, ...) and keep the return shape.
export async function chargeOnline({ amount, currency }) {
  return {
    provider: 'demo',
    reference: `pay_${crypto.randomBytes(8).toString('hex')}`,
    amount,
    currency,
  };
}
