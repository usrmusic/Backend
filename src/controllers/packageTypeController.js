import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listPackageTypes = catchAsync(async (req, res) => {
  const types = await prisma.packageType.findMany();
  res.json(serializeForJson(types));
});

export const getPackageType = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const t = await prisma.packageType.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(t));
});

export const createPackageType = catchAsync(async (req, res) => {
  const { type } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type_required' });
  const created = await prisma.packageType.create({ data: { type } });
  res.status(201).json(serializeForJson(created));
});

export const updatePackageType = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const { type } = req.body || {};
  const updated = await prisma.packageType.update({ where: { id }, data: { type } });
  res.json(serializeForJson(updated));
});

export const deletePackageType = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.packageType.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listPackageTypes, getPackageType, createPackageType, updatePackageType, deletePackageType };
