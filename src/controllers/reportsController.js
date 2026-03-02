import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import { parseFilterSort } from '../utils/queryHelpers.js';
import { toCsv } from '../utils/csvHelper.js';
import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import { getDownloadUrl, uploadFile } from '../utils/uploadHelper.js';
import path from 'path';

export const adminReport = catchAsync(async (req, res) => {
  const opts = parseFilterSort(req.query);
  const events = await prisma.event.findMany({ where: opts.where, orderBy: opts.orderBy, take: opts.take, skip: opts.skip, include: { event_package: true, users_events_user_idTousers: true, venues: true, event_payments: true } });
  res.json(serializeForJson({ success: true, data: events }));
});

export const suppliersReport = catchAsync(async (req, res) => {
  const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
  if (!supplierId) return res.status(400).json({ error: 'supplier_id_required' });

  // find event packages that map to equipment for this supplier
  const packages = await prisma.eventPackage.findMany({ where: { equipment: { supplier_id: supplierId } }, include: { equipment: true, event: true } });
  res.json(serializeForJson({ success: true, data: packages }));
});

export const completedEventsReport = catchAsync(async (req, res) => {
  const opts = parseFilterSort(req.query);
  opts.where = { ...(opts.where || {}), event_status_id: 3 };
  const events = await prisma.event.findMany({ where: opts.where, orderBy: opts.orderBy, take: opts.take, skip: opts.skip, include: { event_package: true, users_events_user_idTousers: true, venues: true } });
  res.json(serializeForJson({ success: true, data: events }));
});

export const cancelledEventsReport = catchAsync(async (req, res) => {
  const opts = parseFilterSort(req.query);
  opts.where = { ...(opts.where || {}), event_status_id: 4 };
  const events = await prisma.event.findMany({ where: opts.where, orderBy: opts.orderBy, take: opts.take, skip: opts.skip, include: { event_package: true, users_events_user_idTousers: true, venues: true } });
  res.json(serializeForJson({ success: true, data: events }));
});

// Generic export endpoint: /reports/export?type=admin|suppliers|completed|cancelled&format=csv|pdf
export const exportReport = catchAsync(async (req, res) => {
  const type = String(req.query.type || 'admin');
  const format = String((req.query.format || 'csv')).toLowerCase();

  let rows = [];
  if (type === 'suppliers') {
    const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
    if (!supplierId) return res.status(400).json({ error: 'supplier_id_required' });
    const packages = await prisma.eventPackage.findMany({ where: { equipment: { supplier_id: supplierId } }, include: { equipment: true, event: { include: { users_events_user_idTousers: true, venues: true } } } });
    rows = packages.map(p => ({ event_id: p.event_id, event_date: p.event?.date || null, equipment_name: p.equipment?.name || null, quantity: p.quantity || 0, total_price: p.total_price || 0, supplier_id: supplierId }));
  } else if (type === 'completed' || type === 'cancelled') {
    const status = type === 'completed' ? 3 : 4;
    const opts = parseFilterSort(req.query);
    opts.where = { ...(opts.where || {}), event_status_id: status };
    const events = await prisma.event.findMany({ where: opts.where, orderBy: opts.orderBy, include: { users_events_user_idTousers: true, venues: true } });
    rows = events.map(e => ({ id: e.id, date: e.date, client: e.users_events_user_idTousers?.name || null, venue: e.venues?.venue || null, status }));
  } else {
    // admin
    const opts = parseFilterSort(req.query);
    const events = await prisma.event.findMany({ where: opts.where, orderBy: opts.orderBy, include: { users_events_user_idTousers: true, venues: true } });
    rows = events.map(e => ({ id: e.id, date: e.date, client: e.users_events_user_idTousers?.name || null, venue: e.venues?.venue || null, status: e.event_status_id }));
  }

  if (format === 'csv') {
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const csv = toCsv(rows, columns);
    const name = `report-${type}-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.send(csv);
  }

  // PDF export
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.fontSize(18).text(`Report: ${type}`, { align: 'center' });
  doc.moveDown();
  const headers = Object.keys(rows[0] || {});
  // small table
  headers.forEach(h => doc.fontSize(10).text(h, { continued: true, width: 120 }));
  doc.moveDown(0.5);
  rows.forEach(r => {
    headers.forEach(h => doc.fontSize(9).text(String(r[h] ?? ''), { continued: true, width: 120 }));
    doc.moveDown(0.2);
  });
  doc.end();

  const pdfBuffer = await getStream.buffer(doc);
  const fileObj = { buffer: pdfBuffer, originalname: `report-${type}-${Date.now()}.pdf`, mimetype: 'application/pdf' };
  const uploaded = await uploadFile(fileObj, { folder: 'reports' }).catch(() => null);
  if (!uploaded) return res.status(500).json({ error: 'upload_failed' });
  const fileKey = uploaded.key || uploaded.url || uploaded;
  const url = await getDownloadUrl(fileKey).catch(() => null);
  res.json(serializeForJson({ url, file: fileKey }));
});

export default { adminReport, suppliersReport, completedEventsReport, cancelledEventsReport, exportReport };
