import { query } from 'express';
import Joi from 'joi';

const listEvents = Joi.object({
  query: Joi.object({
    search: Joi.string().optional(),
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
    van: Joi.string().allow('', null).optional(),
    crew: Joi.string().allow('', null).optional(),
  }),
});

export default { listEvents, getEvent, storeNotes };
