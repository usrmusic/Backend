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
    sortBy: Joi.string()
      .valid("name", "email", "created_at")
      .default("created_at"),
    sortOrder: Joi.string().valid("asc", "desc").default("asc"),
  }),
};
const deleteUser = {
  params: Joi.object({
    id: Joi.number().integer().required(),
    force: Joi.boolean().default(false),
  }),
};

const deleteManyUsers = {
  params: Joi.object({
    ids: Joi.array().items(Joi.number().integer()).min(1).required(),
    force: Joi.boolean().default(false),
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

export default {
  signIn,
  createUser,
  updateUser,
  getUser,
  deleteUser,
  deleteManyUsers,
  forgotPassword,
  verifyEmail,
  listUsers
};
