import Joi from "joi";

const createEquipment = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    is_availabilty_check: Joi.boolean().optional(),
    cost_price: Joi.number().precision(2).min(0).optional(),
    sell_price: Joi.number().precision(2).min(0).required(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE').default('ACTIVE'),
        supplier_id: Joi.number().integer().optional().allow(null),
        supplier_name: Joi.string().trim().min(1).max(200).optional(),
    pricing_guide: Joi.string().trim().max(2000).optional(),
    rig_notes: Joi.string().trim().max(2000).optional(),
  }),
};

const listEquipment = {
    query: Joi.object({
        search: Joi.string().trim().max(200).allow('', null),
        page: Joi.number().integer().min(1).default(1),
        perPage: Joi.number().integer().min(1).max(100).default(25),
        sort: Joi.string().optional(),
        supplier_id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
        filter: Joi.alternatives().try(Joi.string(), Joi.object()).optional(),
    }),
};

const updateEquipment = {
    params : Joi.object({
        id: Joi.number().integer().required(),
    }),
    body: Joi.object({
        name: Joi.string().trim().min(1).max(200),
        is_availabilty_check: Joi.boolean(),
        cost_price: Joi.number().precision(2).min(0),
        sell_price: Joi.number().precision(2).min(0),
        status: Joi.string().valid('ACTIVE', 'INACTIVE'),
        supplier_id: Joi.number().integer().allow(null),
        supplier_name: Joi.string().trim().min(1).max(200),
        pricing_guide: Joi.string().trim().max(2000),
        rig_notes: Joi.string().trim().max(2000),
    }).min(1),
};

const deleteEquipment = {
    params : Joi.object({
        id: Joi.number().integer().required(),
        force: Joi.boolean().default(false),
    }),
};

const deleteManyEquipment = {
    params : Joi.object({
        ids: Joi.alternatives().try(Joi.array().items(Joi.number().integer()), Joi.string()).required(),
    }),
    body: Joi.object({
        force: Joi.boolean().optional(),
    }).optional(),
};

const getEquipment = {
    params : Joi.object({
        id: Joi.number().integer().required(),
    }),
};


export default{
    createEquipment,
    updateEquipment,
    deleteEquipment,
    listEquipment,
    deleteManyEquipment,
    getEquipment,
}