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
    // Optional: a client can be added before any event is booked, and the
    // controller already skips event creation when this is blank. When a
    // date IS given it must still be today or later (Laravel's
    // `after_or_equal:today`). Checked per request in `.custom()` rather than
    // `.min(startOfToday())`, which froze "today" at server start and so
    // silently accepted past dates once the process had been up a few days.
    event_date: Joi.date()
      .iso()
      .allow("", null)
      .custom((value, helpers) => {
        const today = startOfToday();
        return value < today ? helpers.error("date.min", { limit: today }) : value;
      })
      .optional(),
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
    // Updating a client never touches events (see updateClient in the
    // controller), but the edit form used to send event_date along and Joi
    // rejected it as an unknown key. Accept and drop it so an older cached
    // frontend can't trip over it either.
    event_date: Joi.any().strip(),
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
