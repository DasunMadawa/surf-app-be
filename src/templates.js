import { formatDate, formatLKR } from './utils.js';

const APP_URL = () => process.env.APP_URL || 'http://localhost:5173';

function bookingLines(b) {
  return [
    `Reference:     ${b.ref}`,
    `Package:       ${b.packageTitle}`,
    `Date:          ${formatDate(b.date)}`,
    `Time:          ${b.slot}`,
    `Participants:  ${b.participants}`,
    `Total:         ${formatLKR(b.amount, b.currency)} (${b.paymentStatus === 'paid' ? 'paid online' : 'pay at club'})`,
  ];
}

export function clubEmail(club, type, data) {
  switch (type) {
    case 'booking.created':
      return {
        subject: `New booking ${data.ref} — ${data.packageTitle} on ${formatDate(data.date)}`,
        text: [
          `Hi ${club.name},`,
          '',
          'You have a new booking through Stara:',
          '',
          ...bookingLines(data),
          '',
          `Customer:      ${data.customer.name}`,
          `Email:         ${data.customer.email}`,
          `Phone:         ${data.customer.phone}`,
          data.notes ? `Notes:         ${data.notes}` : null,
          '',
          `Confirm or decline it in your dashboard: ${APP_URL()}/partner/dashboard`,
        ]
          .filter((l) => l !== null)
          .join('\n'),
      };
    case 'booking.cancelled':
      return {
        subject: `Booking ${data.ref} was cancelled by the customer`,
        text: [`Hi ${club.name},`, '', `${data.customer.name} cancelled this booking:`, '', ...bookingLines(data)].join('\n'),
      };
    case 'club.activated':
      return {
        subject: `Welcome to Stara — ${club.name} is live`,
        text: [
          `Hi ${club.name},`,
          '',
          'Your surf club was verified automatically and is now listed on Stara.',
          'Customers can already find you and book your packages.',
          '',
          `Dashboard: ${APP_URL()}/partner/dashboard`,
          `API key:   ${data.apiKeyHint}`,
          '',
          'Every new booking will be sent to this email, to your dashboard in real time,',
          'and to your webhook URL if you add one.',
        ].join('\n'),
      };
    case 'webhook.test':
      return null;
    default:
      return { subject: `Stara: ${type}`, text: JSON.stringify(data, null, 2) };
  }
}

const CUSTOMER_COPY = {
  received: ['Booking received', 'has been sent to the surf club. You will get another email as soon as they confirm it.'],
  confirmed: ['Booking confirmed', 'is confirmed. See you in the water! 🏄'],
  declined: ['Booking declined', 'could not be accepted by the club for that time. Any online payment will be refunded in full.'],
  cancelled: ['Booking cancelled', 'has been cancelled.'],
  completed: ['Thanks for surfing with us', 'is complete. We hope you had a great session — leave a review in the app!'],
};

export function customerEmail(booking, kind) {
  const [title, sentence] = CUSTOMER_COPY[kind] || CUSTOMER_COPY.received;
  return {
    subject: `${title}: ${booking.packageTitle} at ${booking.clubName} (${booking.ref})`,
    text: [
      `Hi ${booking.customer.name},`,
      '',
      `Your booking at ${booking.clubName} ${sentence}`,
      '',
      ...bookingLines(booking),
      '',
      `Manage your booking: ${APP_URL()}/bookings/${booking.ref}`,
    ].join('\n'),
  };
}
