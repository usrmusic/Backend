import Joi from "joi";

const createClient = Joi.object({
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().email().lowercase().trim().required(),
    contact_number: Joi.string().trim().min(7).max(32).allow("", null),
    address: Joi.string().trim().max(500).allow("", null),
    event_date: Joi.date().iso().allow(null),
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
    event_date: Joi.date().iso().allow(null),
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
    sortBy: Joi.string()
      .valid("first_name", "last_name", "email", "created_at")
      .default("created_at"),
    sortOrder: Joi.string().valid("asc", "desc").default("asc"),
  }),
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
