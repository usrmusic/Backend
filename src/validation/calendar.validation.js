import { query } from "express";
import Joi from "joi";

const getCalenderEvents = Joi.object({
    query: Joi.object({
        year: Joi.number().integer().min(2000).max(2100).optional(),
        
    })
});


export default { getCalenderEvents }