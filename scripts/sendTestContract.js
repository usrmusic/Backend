/**
 * Render the signed-contract PDF for an event and email it to a TEST inbox.
 *
 * Safe by construction:
 *   - read-only: no contract/signature rows, no event updates, no S3 uploads
 *   - never emails the event's client and never CCs the office address
 *   - refuses any recipient not in TEST_RECIPIENTS below
 *
 * Usage (from Backend/):
 *   npx env-cmd -f .env.local node scripts/sendTestContract.js <event-id> [--to=<email>] [--out=<file.pdf>] [--no-send]
 *   node scripts/sendTestContract.js --sample [--out=<file.pdf>] [--no-send]   # built-in sample data, no DB needed
 *
 * Examples:
 *   npx env-cmd -f .env.local node scripts/sendTestContract.js 1730
 *   node scripts/sendTestContract.js --sample --no-send --out=/tmp/contract.pdf
 */

import fs from 'fs';
import { generateContractPdf } from '../src/utils/pdfGenerator.js';
import { brandAsset } from '../src/utils/brandAssets.js';
import sendEmail from '../src/utils/mail/resendClient.js';
import { buildContractSignedEmail } from '../src/utils/mail/templates/contractSignedEmail.js';

const TEST_RECIPIENTS = ['idevjunaid@gmail.com'];

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name) => flag(name)?.split('=').slice(1).join('=') || null;

const eventId = args.find((a) => /^\d+$/.test(a));
const useSample = Boolean(flag('sample'));
const to = (flagValue('to') || TEST_RECIPIENTS[0]).trim().toLowerCase();
const outFile = flagValue('out');
const noSend = Boolean(flag('no-send'));

if (!eventId && !useSample) {
  console.error('Usage: node scripts/sendTestContract.js <event-id> | --sample [--to=<email>] [--out=<file.pdf>] [--no-send]');
  process.exit(1);
}
if (!TEST_RECIPIENTS.includes(to)) {
  console.error(`Refusing to send to ${to}: not in TEST_RECIPIENTS (${TEST_RECIPIENTS.join(', ')}).`);
  process.exit(1);
}

function sampleData() {
  const items = [
    ['DJ & professional host', 1, 1450], ['Premium sound system + engineer', 1, 900],
    ['Moving-head lighting package', 8, 95], ['LED video wall 6m x 2m', 1, 1200],
    ['Wireless microphone set', 2, 45], ['Live dhol players', 2, 175],
  ];
  return {
    event: {
      id: 0, date: '2028-09-10', total_cost_for_equipment: '4430', deposit_amount: 1000,
      venues: { venue: 'Sample Venue' },
      event_package: items.map(([name, quantity, price]) => ({
        equipment: { name }, quantity, sell_price: price, total_price: quantity * price,
      })),
      event_payments: [{ amount: 1000 }],
    },
    user: { name: 'Sample Client' },
    company: {
      name: 'USR Holding Ltd', street: '23c Church Lane', city: 'Wolverhampton', postal_code: 'WV2 4BT',
      telephone_number: '08008407447', email: 'info@uniquesoundz.co.uk', bank_name: 'Starling Bank',
      account_number: '39464591', sort_code: '608371', contact_name: 'Nick Singh',
    },
  };
}

// Same lookups contractSign.service.js does — reads only.
async function loadFromDb(id) {
  const { default: prisma } = await import('../src/utils/prismaClient.js');
  const { getObjectBuffer } = await import('../src/utils/s3Client.js');
  const event = await prisma.event.findUnique({
    where: { id: Number(id) },
    include: {
      users_events_user_idTousers: true,
      venues: true,
      event_package: { include: { equipment: true } },
      event_payments: true,
    },
  });
  if (!event) throw new Error(`event ${id} not found`);
  let company = event.names_id
    ? await prisma.companyName.findUnique({ where: { id: BigInt(event.names_id) } }).catch(() => null)
    : null;
  if (!company) company = await prisma.companyName.findFirst({ orderBy: { id: 'asc' } }).catch(() => null);
  const adminSignature = company?.admin_signature
    ? await getObjectBuffer(String(company.admin_signature)).catch(() => null)
    : await brandAsset('usr-admin-signature.jpg');
  await prisma.$disconnect().catch(() => {});
  return { event, user: event.users_events_user_idTousers, company, adminSignature };
}

const data = useSample ? sampleData() : await loadFromDb(eventId);

const pdf = await generateContractPdf({
  event: data.event,
  user: data.user,
  company: data.company,
  signature: null, // the client hasn't signed this test copy
  adminSignature: data.adminSignature || null,
  signedAt: new Date(),
});

if (outFile) {
  fs.writeFileSync(outFile, pdf);
  console.log(`PDF written to ${outFile} (${pdf.length} bytes)`);
}

if (noSend) {
  console.log('--no-send given; not emailing.');
  process.exit(0);
}
if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY is not set; nothing was sent.');
  process.exit(1);
}

const { subject, html } = buildContractSignedEmail({
  name: data.user?.name || '',
  signedUrl: '#',
  company: data.company,
  logoUrl: null,
});

const res = await sendEmail({
  to: [to],
  subject: `[TEST] ${subject}`,
  html,
  attachments: [{ filename: `contract_${data.event.id}.pdf`, content: pdf }],
});

if (res?.error || res?.ok === false) {
  console.error('Send failed:', res.error);
  process.exit(1);
}
console.log(`Sent test contract for event ${data.event.id} to ${to}`, res?.data?.id || res?.id || '');
process.exit(0);
