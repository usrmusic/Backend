import Joi from "joi";

const createCompany = {
    body: Joi.object({
        name: Joi.string().trim().min(1).max(50).required(),
        company_logo: Joi.string().trim().max(200).required(),
        brochure: Joi.string().trim().max(200).required(),
        contact_name: Joi.string().trim().max(100).optional().allow(null, ""),
        telephone_number: Joi.string().trim().max(20).optional().allow(null, ""),
        email: Joi.string().email().trim().max(50).optional().allow(null, ""),
        website: Joi.string().uri().trim().max(50).optional().allow(null, ""),
        instagram: Joi.string().trim().max(50).optional().allow(null, ""),
        facebook: Joi.string().trim().max(50).optional().allow(null, ""),
        address_name: Joi.string().trim().max(50).optional().allow(null, ""),
        street: Joi.string().trim().max(50).optional().allow(null, ""),
        city: Joi.string().trim().max(50).optional().allow(null, ""),
        postal_code: Joi.string().trim().max(50).optional().allow(null, ""),
        bank_name: Joi.string().trim().max(50).optional().allow(null, ""),
        sort_code: Joi.string().trim().max(50).optional().allow(null, ""),
        account_number: Joi.string().trim().max(50).optional().allow(null, ""),
        vat: Joi.string().trim().max(100).optional().allow(null, ""),
        vat_percentage: Joi.string().trim().max(20).optional().allow(null, ""),
        admin_signature: Joi.string().trim().max(4096).required(),
        created_at: Joi.date().optional(),
        updated_at: Joi.date().optional(),
    }),
};

const updateCompany = {
    params: Joi.object({ id: Joi.number().integer().required() }),
    body: Joi.object({
        name: Joi.string().trim().min(1).max(50),
        company_logo: Joi.string().trim().max(200).optional().allow(null, ""),
        brochure: Joi.string().trim().max(200).optional().allow(null, ""),
        contact_name: Joi.string().trim().max(100).optional().allow(null, ""),
        telephone_number: Joi.string().trim().max(20).optional().allow(null, ""),
        email: Joi.string().email().trim().max(50).optional().allow(null, ""),
        website: Joi.string().uri().trim().max(50).optional().allow(null, ""),
        instagram: Joi.string().trim().max(50).optional().allow(null, ""),
        facebook: Joi.string().trim().max(50).optional().allow(null, ""),
        address_name: Joi.string().trim().max(50).optional().allow(null, ""),
        street: Joi.string().trim().max(50).optional().allow(null, ""),
        city: Joi.string().trim().max(50).optional().allow(null, ""),
        postal_code: Joi.string().trim().max(50).optional().allow(null, ""),
        bank_name: Joi.string().trim().max(50).optional().allow(null, ""),
        sort_code: Joi.string().trim().max(50).optional().allow(null, ""),
        account_number: Joi.string().trim().max(50).optional().allow(null, ""),
        vat: Joi.string().trim().max(100).optional().allow(null, ""),
        vat_percentage: Joi.string().trim().max(20).optional().allow(null, ""),
        admin_signature: Joi.string().trim().max(4096).optional().allow(null, ""),
        updated_at: Joi.date().optional(),
    }).min(1),
};

const getCompany = { params: Joi.object({ id: Joi.number().integer().required() }) };

const listCompanies = {
    params: Joi.object({
        search: Joi.string().trim().max(200).allow('', null),
        page: Joi.number().integer().min(1).default(1),
        perPage: Joi.number().integer().min(1).max(100).default(25),
        sort: Joi.string().optional(),
    }),
};

const deleteCompany = { params: Joi.object({ id: Joi.number().integer().required(), force: Joi.boolean().default(false) }) };

const deleteCompanies = {
    body: Joi.object({ ids: Joi.alternatives().try(Joi.array().items(Joi.number().integer()), Joi.string()).required(), force: Joi.boolean().optional() }).optional(),
};

export default {
    createCompany,
    updateCompany,
    getCompany,
    listCompanies,
    deleteCompany,
    deleteCompanies,
};