import { query } from "express";
import Joi from "joi";

const getDashboardStats = {
  query: Joi.object({
    year: Joi.number()
      .integer()
      .min(2000)
      // +1 so the header's year picker (which includes next year) doesn't
      // 400 the moment someone selects it.
      .max(new Date().getFullYear() + 1)
      .required(),
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
