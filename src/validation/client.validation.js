import Joi from "joi";

const createClient = Joi.object({
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().email().lowercase().trim().required(),
    contact_number: Joi.string().trim().min(7).max(32).allow("", null),
    address: Joi.string().trim().max(500).allow("", null),
    event_date: Joi.date().iso().allow(null),
  }),
});

const updateClient = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
  body: Joi.object({
    first_name: Joi.string().trim().min(2).max(100),
    last_name: Joi.string().trim().min(0).max(100).allow("", null),
    email: Joi.string().email().lowercase().trim(),
    phone: Joi.string().trim().min(7).max(32).allow("", null),
    company: Joi.string().trim().max(200).allow("", null),
    address: Joi.string().trim().max(500).allow("", null),
    city: Joi.string().trim().max(100).allow("", null),
    postcode: Joi.string().trim().max(20).allow("", null),
    country: Joi.string().trim().max(100).allow("", null),
    notes: Joi.string().trim().max(2000).allow("", null),
  }),
}).min(1);

const getClient = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
});

const deleteClient = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
});

const listClients = Joi.object({
  params: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
    page: Joi.number().integer().min(1).default(1),
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
