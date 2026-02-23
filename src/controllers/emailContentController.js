import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import { serializeForJson } from '../utils/serialize.js';

export const listEmailContent = catchAsync(async (req, res) => {
  const data = await prisma.emailContent.findMany({ orderBy: { id: 'asc' } });
  res.json({ success: true, data: serializeForJson(data) });
});

export const updateEmailContent = catchAsync(async (req, res) => {
  const idParam = req.params.id ? Number(req.params.id) : null;
  const payload = req.body || {};
  const id = idParam || (payload.id ? Number(payload.id) : null);
  if (!id) return res.status(400).json({ success: false, error: 'id_required' });
  if (!payload.body || String(payload.body).trim().length === 0) return res.status(422).json({ success: false, errors: { body: ['body is required'] } });

  const existing = await prisma.emailContent.findUnique({ where: { id: BigInt(id) } });
  if (!existing) throw new AppError('not_found', 404);

  const updateData = { ...payload, updated_at: new Date() };
  // convert numeric id fields if present
  if (updateData.id) delete updateData.id;

  const updated = await prisma.emailContent.update({ where: { id: BigInt(id) }, data: updateData });
  res.json({ success: true, data: serializeForJson(updated) });
});

export const getEmailData = catchAsync(async (req, res) => {
  const emailName = req.query.email_name || req.body.email_name;
  const eventId = req.query.eventId || req.body.eventId;

  let deposit_amount = null;
  if (eventId) {
    const ev = await prisma.event.findUnique({ where: { id: Number(eventId) }, select: { deposit_amount: true } });
    if (ev) deposit_amount = ev.deposit_amount;
  }

  const rows = emailName
    ? await prisma.emailContent.findMany({ where: { email_name: String(emailName) } })
    : await prisma.emailContent.findMany();

  res.json({ success: true, data: serializeForJson(rows), deposit_amount });
});

export default { listEmailContent, updateEmailContent, getEmailData };
