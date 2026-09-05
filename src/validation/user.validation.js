import Joi from "joi";

const signIn = {
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),
};

const createUser = {
  body: Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    contact_number: Joi.string().allow(null, ""),
    role_id: Joi.number().integer().required(),
    address: Joi.string().allow(null, ""),
    email_send: Joi.boolean().default(false),
    sendEmail: Joi.boolean().default(false),
    color: Joi.string()
      .pattern(/^#[0-9a-fA-F]{6}$/)
      .allow(null, "")
      .messages({ "string.pattern.base": "color must be a #rrggbb hex value" }),
  }),
};

const updateUser = {
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object({
    name: Joi.string(),
    email: Joi.string().email(),
    contact_number: Joi.string().allow(null, ""),
    role_id: Joi.number().integer(),
    address: Joi.string().allow(null, ""),
    email_send: Joi.boolean(),
    sendEmail: Joi.boolean(),
    // Calendar identity colour. Constrained to `#rrggbb` so the value can be
    // dropped straight into CSS (and into color-mix()) without sanitising at
    // every render site. Null/"" clears it back to the grey fallback.
    color: Joi.string()
      .pattern(/^#[0-9a-fA-F]{6}$/)
      .allow(null, "")
      .messages({ "string.pattern.base": "color must be a #rrggbb hex value" }),
  }),
};

const getUser = {
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
};

const listUsers = {
  params: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    perPage: Joi.number().integer().min(1).max(100).default(10),
    // The controller reads `sort_by`/`sort_dir` (snake_case) — this
    // validated `sortBy`/`sortOrder` instead, so a real `sort_by` sent by
    // any column click was rejected as an unknown key and the table went
    // blank. `.unknown(true)` is a safety net for the same class of bug on
    // any other param the frontend might send.
    sort_by: Joi.string()
      .valid("name", "email", "contact_number", "address", "created_at")
      .default("created_at"),
    sort_dir: Joi.string().valid("asc", "desc").default("asc"),
  }).unknown(true),
};
const deleteUser = {
  params: Joi.object({
    id: Joi.number().integer().required(),
    force: Joi.boolean().default(false),
  }),
};

const deleteManyUsers = {
  body: Joi.object({
    ids: Joi.array().items(Joi.number().integer()).min(1).required(),
    force: Joi.boolean().default(false),
  }),
};

const restoreUsers = {
  body: Joi.object({
    ids: Joi.array().items(Joi.number().integer()).min(1).required(),
  }),
};

const forgotPassword = {
  body: Joi.object({
    email: Joi.string().email().required(),
  }),
};

const verifyEmail = {
  body: Joi.object({
    token: Joi.string().required(),
  }),
};

const resetPasswordWithToken = {
  body: Joi.object({
    email: Joi.string().email().required(),
    token: Joi.string().required(),
    password: Joi.string().min(8).max(72).required(),
  }),
};

export default {
  signIn,
  createUser,
  updateUser,
  getUser,
  deleteUser,
  deleteManyUsers,
  restoreUsers,
  forgotPassword,
  resetPasswordWithToken,
  verifyEmail,
  listUsers,
};
