import Joi from "joi";

const createPackage = {
  body: Joi.object({
    user_id: Joi.number().integer().required(),
    
    package_name: Joi.string().trim().min(1).max(255).required(),
    cost_price: Joi.number().precision(2).min(0).required(),
    sell_price: Joi.number().precision(2).min(0).required(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE').default('ACTIVE'),
    equipments: Joi.array()
      .items(
        Joi.object({
          equipment_id: Joi.number().integer().required(),
          quantity: Joi.number().integer().min(0).optional(),
          equipment_order_id: Joi.number().integer().optional(),
        })
      )
      .optional(),
  }),
};

const updatePackage = {
  params: Joi.object({ id: Joi.number().integer().required() }),
  body: Joi.object({
    user_id: Joi.number().integer(),
    package_name: Joi.string().trim().min(1).max(255),
    cost_price: Joi.number().precision(2).min(0),
    sell_price: Joi.number().precision(2).min(0),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
    equipments: Joi.array()
      .items(
        Joi.object({
          equipment_id: Joi.number().integer().required(),
          quantity: Joi.number().integer().min(0).optional(),
          equipment_order_id: Joi.number().integer().optional(),
        })
      )
      .optional(),
  }).min(1),
};

const getPackage = {
  params: Joi.object({ id: Joi.number().integer().required() }),
};

const listPackages = {
  params: Joi.object({
    search: Joi.string().trim().max(200).allow('', null),
    page: Joi.number().integer().min(1).default(1),
    perPage: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().valid('package_name', 'cost_price', 'sell_price', 'created_at').default('created_at'),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};

const deletePackage = {
  params: Joi.object({ id: Joi.number().integer().required(), force: Joi.boolean().default(false) }),
};

const deleteManyPackages = {
  body: Joi.object({ ids: Joi.alternatives().try(Joi.array().items(Joi.number().integer()), Joi.string()).required(), force: Joi.boolean().optional() }).optional(),
};

export default {
  createPackage,
  updatePackage,
  getPackage,
  listPackages,
  deletePackage,
  deleteManyPackages,
};