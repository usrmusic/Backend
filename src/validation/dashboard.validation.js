import { query } from "express";
import Joi from "joi";

const getDashboardStats = {
  query: Joi.object({
    // Static bound, matching calendar.validation.js / reports.validation.js —
    // not tied to the server's clock at startup. The header's year picker
    // allows up to current year + 5; a relative "+1" baked in once at import
    // time went stale (or mismatched the picker's own range) and rejected
    // any of those valid future-year selections with a 400.
    year: Joi.number().integer().min(2000).max(2100).required(),
  }),
};

const getEventsDropDown = {
  params: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
  }),
};

const getUpcomingEvents = {
  query: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
  }),
};
export default { getDashboardStats, getUpcomingEvents, getEventsDropDown };
