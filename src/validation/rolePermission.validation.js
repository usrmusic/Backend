import Joi from "joi";

const storeRole = Joi.object({
  body: Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    guard_name: Joi.string().trim().max(100).allow("", null),
  }),
});

const updateRole = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(200),
  }).min(1),
});

const storePermission = Joi.object({
  body: Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    guard_name: Joi.string().trim().max(100).allow("", null),
  }),
});

const updatePermission = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(200),
  }).min(1),
});

const getRolePermissions = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
});

const destroyRole = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
});

const destroyPermission = Joi.object({
  params: Joi.object({
    id: Joi.number().required(),
  }),
});

const assignPermissions = Joi.object({
  body: Joi.object({
    roleId: Joi.number().required(),
    permissionIds: Joi.array().items(Joi.number().integer()).required(),
  }),
});

export default {
  storeRole,
  updateRole,
  storePermission,
  updatePermission,
  getRolePermissions,
  destroyRole,
  destroyPermission,
  assignPermissions,
};
