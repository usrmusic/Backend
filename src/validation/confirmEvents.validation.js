import Joi from 'joi';

const dateRegex = /^\d{2}-\d{2}-\d{4}$/; // DD-MM-YYYY
const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/; // HH:mm


const getEmail = Joi.object({
  query: Joi.object({
    email_name: Joi.string().required(),
    event_id: Joi.number().integer().required(),
  })
});

const sendEmail = Joi.object({
  body: Joi.object({
    event_id: Joi.number().integer().required(),
    body: Joi.string().required(),
    subject: Joi.string().required(),
    company_name_id: Joi.number().integer().required(),
  })
});

const listConfirmEvents = Joi.object({
  query: Joi.object({
    search: Joi.string().trim().max(100).allow('', null),
  })
});

const confirmEvent = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object({
    event_date: Joi.string().pattern(dateRegex).required(),
    company_name: Joi.string().required(),
    deposit_amount: Joi.number().required(),
    payment_method_id: Joi.number().integer().required(),
  }),
});

const getConfirmEvent = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
});


export default {
    listConfirmEvents,
    confirmEvent,
    getConfirmEvent,
    sendEmail,
    getEmail
}