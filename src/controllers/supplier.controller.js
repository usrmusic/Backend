import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listSuppliers = catchAsync(async (req, res) => {
  const suppliers = await prisma.supplier.findMany();
  res.json(serializeForJson(suppliers));
});

export const getSupplier = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(supplier));
});

export const createSupplier = catchAsync(async (req, res) => {
  const { name, company_name, email, contact_number, industry, notes, created_by } = req.body || {};

  const data = {
    name: name || null,
    company_name: company_name || null,
    email: email || null,
    contact_number: contact_number || null,
    industry: industry || null,
    notes: notes || null,
    created_by: created_by ? Number(created_by) : null,
  };

  let created;
  try {
    created = await prisma.supplier.create({ data });
  } catch (err) {
    console.error('prisma.supplier.create error', err);
    return res.status(500).json({ error: 'supplier_create_failed', details: err && err.message });
  }

  res.status(201).json(serializeForJson(created));
});

export const updateSupplier = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const allowed = ['name','company_name','email','contact_number','industry','notes','updated_by'];
  const data = {};
  for (const k of allowed) {
    if (k in req.body && req.body[k] !== undefined) {
      data[k] = k === 'updated_by' ? Number(req.body[k]) : req.body[k];
    }
  }
  data.updated_at = new Date();

  const updated = await prisma.supplier.update({ where: { id }, data });
  res.json(serializeForJson(updated));
});

export const deleteSupplier = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  try {
    await prisma.supplier.delete({ where: { id } });
  } catch (err) {
    console.error('prisma.supplier.delete error', err);
    return res.status(500).json({ error: 'supplier_delete_failed', details: err && err.message });
  }

  res.json({ ok: true });
});

export default { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier };
