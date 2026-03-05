import Joi from "joi";

const listEmailContent = Joi.object({
  query: Joi.object({
    search: Joi.string().trim().max(200).allow('', null),
    page: Joi.number().integer().min(1).default(1),
    perPage: Joi.number().integer().min(1).max(100).default(25),
    sort: Joi.string().optional(),
  }),
});

const getEmailData = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
});

const updateEmailContent = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
  body: Joi.object({
    email_name: Joi.string().trim().max(255).allow("", null),
    subject: Joi.string().trim().max(255).allow("", null),
    body: Joi.string().trim().min(1).required(),
  }),
});

export default {
  listEmailContent,
  getEmailData,
  updateEmailContent,
};