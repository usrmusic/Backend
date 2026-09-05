import Joi from "joi";

// Start of today (local server time), used to match Laravel's
// `after_or_equal:today` date-only comparison (not a strict "now" cutoff).
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const createClient = Joi.object({
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().email().lowercase().trim().required(),
    contact_number: Joi.string().trim().min(7).max(32).allow("", null),
    address: Joi.string().trim().max(500).allow("", null),
    // Laravel's StoreClientRequest requires event_date on client creation:
    // 'required|date|after_or_equal:today'
    event_date: Joi.date().iso().min(startOfToday()).required(),
    role_id: Joi.number().integer().required(),
  }),
});

const updateClient = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
  body: Joi.object({
    name: Joi.string().trim().min(0).max(100).allow("", null),
    email: Joi.string().email().lowercase().trim(),
    contact_number: Joi.string().trim().min(7).max(32).allow("", null),
    address: Joi.string().trim().max(500).allow("", null),
    role_id: Joi.number().integer(),
  }),
});

const getClient = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
});

const deleteClient = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
    force: Joi.boolean().default(false),
  }),
});

const listClients = Joi.object({
  params: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
    page: Joi.number().integer().min(1).default(1),
    perPage: Joi.number().integer().min(1).max(100).default(10),
    limit: Joi.number().integer().min(1).max(100).default(10),
    // The controller reads `sort_by`/`sort_dir` (snake_case) — this used to
    // validate the wrong key names entirely (`sortBy`/`sortOrder`, and
    // `first_name`/`last_name` which don't exist on the User model; the
    // real column is `name`), so clicking any column sort sent a real
    // `sort_by` that Joi rejected as an unknown key, and the table went
    // blank. `.unknown(true)` is a safety net for the same class of bug on
    // any other param the frontend might send.
    sort_by: Joi.string()
      .valid("name", "email", "contact_number", "address", "created_at")
      .default("created_at"),
    sort_dir: Joi.string().valid("asc", "desc").default("asc"),
  }).unknown(true),
});

const deleteManyClients = Joi.object({
  params: Joi.object({
    ids: Joi.array().items(Joi.number().integer()).min(1).required(),
    force: Joi.boolean().default(false),
  }),
});

export default {
  createClient,
  updateClient,
  getClient,
  listClients,
  deleteClient,
  deleteManyClients,
};
