import { query } from "express";
import Joi from "joi";

const getDashboardStats = {
  query: Joi.object({
    year: Joi.number()
      .integer()
      .min(2000)
      .max(new Date().getFullYear())
      .required(),
  }),
};

const getEventsDropDown = {
  params: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
  }),
};

export default { getDashboardStats };
