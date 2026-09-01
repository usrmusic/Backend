import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";
import { logActivity } from "../utils/activityLogger.js";

const emailContentSvc = services.get("emailContent");


export const listEmailContent = catchAsync(async (req, res) => {
  const perPage = Number(req.query.perPage || 25);
  const page = Number(req.query.page || 1);
  const sort = req.query.sort;

  // build base filter from query
  let filter = {};

  const search = req.query.search || req.query.q;
  if (search) {
    const s = String(search).trim();
    if (s.length) filter.email_name = { contains: s };
  }

  const rows = await emailContentSvc.list({ filter, perPage, page, sort });
  const total = await emailContentSvc.model
    .count({ where: filter })
    .catch(() => 0);

  return res.json({
    data: serializeForJson(rows),
    meta: { total, page, perPage },
  });
});

export const updateEmailContent = catchAsync(async (req, res) => {
  const idParam = req.params.id ? Number(req.params.id) : null;
  const payload = req.body || {};
  const id = idParam || (payload.id ? Number(payload.id) : null);
  if (!id)
    return res.status(400).json({ success: false, error: "id_required" });
  if (!payload.body || String(payload.body).trim().length === 0)
    return res
      .status(422)
      .json({ success: false, errors: { body: ["body is required"] } });

  const existing = await emailContentSvc.getById(BigInt(id));
  if (!existing) throw new AppError("not_found", 404);

  const updateData = { ...payload, updated_at: new Date() };
  // convert numeric id fields if present
  if (updateData.id) delete updateData.id;

  const updated = await emailContentSvc.update(BigInt(id), updateData);

  await logActivity(null, {
    log_name: "email template updated",
    description: `Email template #${Number(id)} updated`,
    subject_type: "EmailContent",
    subject_id: Number(id),
    causer_id: req.user?.id || null,
    properties: {
      old_subject: existing.subject,
      new_subject: updateData.subject,
      body_changed:
        updateData.body !== undefined &&
        String(updateData.body) !== String(existing.body),
    },
  });

  res.json(serializeForJson(updated));
});

export const getEmailData = catchAsync(async (req, res) => {
  const id = req.params.id ? Number(req.params.id) : null;
  if (!id)
    return res.status(400).json({ success: false, error: "id_required" });


  const row = await emailContentSvc.getById(BigInt(id));
  if (!row) return res.status(404).json({ success: false, error: "not_found" });

  res.json(serializeForJson(row));
});

export default { listEmailContent, updateEmailContent, getEmailData };
