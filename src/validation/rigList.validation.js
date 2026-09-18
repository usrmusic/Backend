import { query } from 'express';
import Joi from 'joi';

const listEvents = Joi.object({
  query: Joi.object({
    search: Joi.string().optional(),
    // Staff normally only see events they're the DJ for — this lets a staff
    // member opt into seeing every confirmed event, matching the "Show
    // cancelled events" checkbox pattern on Confirmed Events. No effect for
    // Admin/Super Admin, who already see everything.
    show_all: Joi.boolean().truthy("true", "1").falsy("false", "0").optional(),
  }),
});

const getEvent = Joi.object({
  query: Joi.object({
    id: Joi.number().integer().required(),
  }),
});

const storeNotes = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object({
    notes: Joi.string().allow('', null).optional(),
    note: Joi.string().allow('', null).optional(),
    van: Joi.string().allow('', null).optional(),
    crew: Joi.string().allow('', null).optional(),
  }),
});

export default { listEvents, getEvent, storeNotes };
