import Joi from "joi";

const createSupplier = {
	body: Joi.object({
		name: Joi.string().trim().min(1).max(100).required(),
		company_name: Joi.string().trim().max(200).allow('', null),
		email: Joi.string().email().lowercase().trim().allow('', null),
		contact_number: Joi.string().trim().min(7).max(32).allow('', null),
		industry: Joi.string().trim().max(100).allow('', null),
		notes: Joi.string().trim().max(2000).allow('', null),
	}),
};

const updateSupplier = {
	params: Joi.object({ id: Joi.number().integer().required() }),
	body: Joi.object({
		name: Joi.string().trim().min(1).max(100),
		company_name: Joi.string().trim().max(200).allow('', null),
		email: Joi.string().email().lowercase().trim().allow('', null),
		contact_number: Joi.string().trim().min(7).max(32).allow('', null),
		industry: Joi.string().trim().max(100).allow('', null),
		notes: Joi.string().trim().max(2000).allow('', null),
	}).min(1),
};

const getSupplier = {
	params: Joi.object({ id: Joi.number().integer().required() }),
};

const listSuppliers = {
	params: Joi.object({
		search: Joi.string().trim().max(200).allow('', null),
		page: Joi.number().integer().min(1).default(1),
		perPage: Joi.number().integer().min(1).max(200).default(25),
		sort_by: Joi.string().valid('name', 'company_name', 'created_at').default('created_at'),
		sort_dir: Joi.string().valid('asc', 'desc').default('asc'),
	}),
};

const deleteSupplier = {
	params: Joi.object({ id: Joi.number().integer().required(), force: Joi.boolean().default(false) }),
};

const deleteManySuppliers = {
	params: Joi.object({
		ids: Joi.alternatives()
			.try(Joi.array().items(Joi.number().integer()), Joi.string())
			.required(),
	}),
	body: Joi.object({
		force: Joi.boolean().optional(),
	}).optional(),
};

export default {
	createSupplier,
	updateSupplier,
	getSupplier,
	listSuppliers,
	deleteSupplier,
	deleteManySuppliers,
};

