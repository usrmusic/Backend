import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import catchAsync from '../utils/catchAsync.js';
import prisma from '../utils/prismaClient.js';
import { uploadFile, getDownloadUrl } from '../utils/uploadHelper.js';
import { serializeForJson } from '../utils/serialize.js';
import path from 'path';

// Generate a simple invoice PDF for an event, store it via upload helper and return URL
export const generateInvoicePdf = catchAsync(async (req, res) => {
  const eventId = Number(req.params.eventId || req.query.eventId || req.body.eventId);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { event_package: true, users_events_user_idTousers: true, venues: true, event_payments: true } });
  if (!event) return res.status(404).json({ error: 'event_not_found' });

  // create PDF in-memory
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(20).text('Invoice', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Event ID: ${event.id}`);
  doc.text(`Date: ${event.date ? new Date(event.date).toISOString().slice(0,10) : ''}`);
  doc.text(`Client: ${event.users_events_user_idTousers?.name || ''}`);
  doc.text(`Venue: ${event.venues?.venue || ''}`);
  doc.moveDown();

  doc.text('Packages:', { underline: true });
  (event.event_package || []).forEach((p, i) => {
    doc.text(`${i+1}. Equipment ${p.equipment_id || ''} - Qty: ${p.quantity || 0} - Price: ${p.sell_price || p.total_price || 0}`);
  });

  doc.moveDown();
  doc.text(`Total: ${event.total_cost_for_equipment || ''}`);

  // footer
  doc.moveDown();
  doc.text('Thank you for your business.', { align: 'center' });

  doc.end();

  // collect PDF buffer
  const pdfBuffer = await getStream.buffer(doc);

  // upload via helper into folder 'invoices'
  const fileObj = { buffer: pdfBuffer, originalname: `invoice-event-${eventId}.pdf`, mimetype: 'application/pdf' };
  const uploaded = await uploadFile(fileObj, { folder: 'invoices' });
  const fileKey = uploaded && (uploaded.key || uploaded.url) ? (uploaded.key || uploaded.url) : null;
  if (!fileKey) return res.status(500).json({ error: 'upload_failed' });

  // create a fileUpload record for traceability
  try {
    await prisma.fileUpload.create({ data: { file_name: fileKey, file_type: 'application/pdf', event_id: eventId, created_by: req.user?.id || null } });
  } catch (e) {}

  const url = await getDownloadUrl(fileKey).catch(()=>null);
  if (!url) return res.status(500).json({ error: 'download_url_error' });

  res.status(201).json(serializeForJson({ url, file: fileKey }));
});

export const downloadInvoice = catchAsync(async (req, res) => {
  const eventId = Number(req.params.eventId || req.query.eventId || req.body.eventId);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  // prefer latest fileUpload for this event with folder 'invoices' or filename pattern
  const f = await prisma.fileUpload.findFirst({ where: { event_id: eventId, file_type: 'application/pdf' }, orderBy: { id: 'desc' } });
  if (!f) return res.status(404).json({ error: 'no_invoice_found' });

  const url = await getDownloadUrl(f.file_name).catch(()=>null);
  if (!url) return res.status(500).json({ error: 'download_url_error' });
  res.json(serializeForJson({ url }));
});

// POST /pdf/invoice/:eventId/generate-rich
export const generateRichInvoicePdf = catchAsync(async (req, res) => {
  const eventId = Number(req.params.eventId || req.query.eventId || req.body.eventId);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { event_package: { include: { equipment: true } }, users_events_user_idTousers: true, venues: true, event_payments: true, contracts: true } });
  if (!event) return res.status(404).json({ error: 'event_not_found' });

  // Build a nicer invoice layout
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  // Header
  doc.image(path.join(process.cwd(), 'public', 'images', 'logo.png'), 40, 40, { width: 120, height: 40, align: 'left' }).moveDown(2);
  doc.fontSize(20).text('INVOICE', { align: 'right' });
  doc.moveDown();

  // Client + Invoice meta
  const client = event.users_events_user_idTousers || {};
  const invoiceNumber = event.invoice || ('INV-' + String(event.id).padStart(6, '0'));
  doc.fontSize(10).text(`Invoice: ${invoiceNumber}`, { align: 'right' });
  doc.text(`Date: ${event.date ? new Date(event.date).toISOString().slice(0,10) : ''}`, { align: 'right' });

  doc.moveDown();
  doc.fontSize(12).text('Bill To:', { underline: true });
  doc.fontSize(10).text(client.name || event.usr_name || 'Client');
  if (client.email) doc.text(client.email);
  if (client.contact_number) doc.text(client.contact_number);
  doc.moveDown();

  // Table header
  doc.fontSize(11).text('Description', 40, doc.y, { continued: true });
  doc.text('Qty', 320, doc.y, { width: 50, align: 'right', continued: true });
  doc.text('Unit', 380, doc.y, { width: 80, align: 'right', continued: true });
  doc.text('Total', 470, doc.y, { width: 90, align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

  let subtotal = 0;
  (event.event_package || []).forEach((p) => {
    const desc = p.equipment?.name || `Equipment ${p.equipment_id || ''}`;
    const qty = Number(p.quantity || 1);
    const unit = Number(p.sell_price || p.total_price || 0);
    const total = qty * unit;
    subtotal += total;

    doc.moveDown(0.5);
    doc.fontSize(10).text(desc, 40, doc.y, { continued: true });
    doc.text(String(qty), 320, doc.y, { width: 50, align: 'right', continued: true });
    doc.text(String(unit.toFixed(2)), 380, doc.y, { width: 80, align: 'right', continued: true });
    doc.text(String(total.toFixed(2)), 470, doc.y, { width: 90, align: 'right' });
  });

  doc.moveDown();
  doc.text('Subtotal', 380, doc.y, { width: 80, align: 'right', continued: true });
  doc.text(String(subtotal.toFixed(2)), 470, doc.y, { width: 90, align: 'right' });

  const vat = event.vat_value ? Number(event.vat_value) : 0;
  if (vat > 0) {
    doc.moveDown();
    doc.text('VAT', 380, doc.y, { width: 80, align: 'right', continued: true });
    doc.text(String(vat.toFixed(2)), 470, doc.y, { width: 90, align: 'right' });
  }

  const totalAmount = event.total_cost_for_equipment ? Number(event.total_cost_for_equipment) : subtotal + vat;
  doc.moveDown();
  doc.fontSize(12).text('Total', 380, doc.y, { width: 80, align: 'right', continued: true });
  doc.text(String(totalAmount.toFixed(2)), 470, doc.y, { width: 90, align: 'right' });

  doc.moveDown(2);
  doc.fontSize(10).text('Notes:', { underline: true });
  if (event.details) doc.text(event.details);

  doc.end();

  const pdfBuffer = await getStream.buffer(doc);
  const fileObj = { buffer: pdfBuffer, originalname: `invoice-rich-event-${eventId}.pdf`, mimetype: 'application/pdf' };
  const uploaded = await uploadFile(fileObj, { folder: 'invoices' }).catch(() => null);
  if (!uploaded) return res.status(500).json({ error: 'upload_failed' });
  const fileKey = uploaded.key || uploaded.url || uploaded;
  try { await prisma.fileUpload.create({ data: { file_name: fileKey, file_type: 'application/pdf', event_id: eventId, created_by: req.user?.id || null } }); } catch (e) {}
  const url = await getDownloadUrl(fileKey).catch(() => null);
  res.status(201).json(serializeForJson({ url, file: fileKey }));
});

export default { generateInvoicePdf, downloadInvoice, generateRichInvoicePdf };
