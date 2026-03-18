import Joi from "joi";

const suppliersReport = Joi.object({
    query: Joi.object({
        event_type: Joi.string().optional(),
        startDate: Joi.string().optional(),
        endDate: Joi.string().optional(),
        search: Joi.string().optional(),
        supplier_id: Joi.number().integer().optional(),
        page: Joi.number().integer().min(1).optional(),
        perPage: Joi.number().integer().min(1).max(100).optional(),
        sort: Joi.string().optional(),
        year: Joi.number().integer().min(2000).max(2100).optional(),
        supplier_name: Joi.string().optional(),
        event_date: Joi.string().optional(),
        event_start_time: Joi.string().optional(),
        event_end_time: Joi.string().optional(),
        venue_name: Joi.string().optional(),
        cost: Joi.number().optional(),
        quantity: Joi.number().integer().optional(),
        payment_send: Joi.boolean().optional(),
        payment_date: Joi.string().optional(),
    })
});

const adminReport = Joi.object({
    query: Joi.object({
        startDate: Joi.string().optional(),
        endDate: Joi.string().optional(),
        search: Joi.string().optional(),
        page: Joi.number().integer().min(1).optional(),
        perPage: Joi.number().integer().min(1).max(100).optional(),
        sort: Joi.string().optional(),
        company_name: Joi.string().optional(),
        client_name: Joi.string().optional(),
        event_date: Joi.string().optional(),
        event_status: Joi.string().optional(),
        dj_name: Joi.string().optional(),
        venue_name: Joi.string().optional(),
        total_price: Joi.number().optional(),
        cost: Joi.number().optional(),
        extra_cost: Joi.number().optional(),
        profit: Joi.number().optional(),
        payment_received: Joi.number().optional(),
        payment_outstanding: Joi.number().optional(),
    })
});

export default {suppliersReport, adminReport};