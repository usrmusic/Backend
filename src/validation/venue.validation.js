import Joi from 'joi';

const createVenue = {
    body: Joi.object({
        venue: Joi.string().trim().min(1).max(100).required(),
        // legacy clients may send `address` or `venue_address`
        address: Joi.string().trim().max(200).allow('', null),
        venue_address: Joi.string().trim().max(200).allow('', null),
        stage: Joi.string().trim().max(100).allow('', null),
        power: Joi.string().trim().max(100).allow('', null),
        access: Joi.string().trim().max(100).allow('', null),
        smoke_haze: Joi.string().trim().max(100).allow('', null),
        rigging_point: Joi.string().trim().max(100).allow('', null),
        // `attachment` may be an uploaded file (multipart) or an URL string
        attachment: Joi.string().uri().trim().max(255).allow('', null),
        notes: Joi.string().trim().max(2000).allow('', null),
    }),
};

const updateVenue = {
    params: Joi.object({ id: Joi.number().integer().required() }),
    body: Joi.object({
        venue: Joi.string().trim().min(1).max(100),
        address: Joi.string().trim().max(200).allow('', null),
        venue_address: Joi.string().trim().max(200).allow('', null),
        stage: Joi.string().trim().max(100).allow('', null),
        power: Joi.string().trim().max(100).allow('', null),
        access: Joi.string().trim().max(100).allow('', null),
        smoke_haze: Joi.string().trim().max(100).allow('', null),
        rigging_point: Joi.string().trim().max(100).allow('', null),
        // allow attachment URL; file uploads are handled by multer in routes
        attachment: Joi.string().uri().trim().max(255).allow('', null),
        notes: Joi.string().trim().max(2000).allow('', null),
    }).min(1),
};

const getVenue = {
    params: Joi.object({ id: Joi.number().integer().required() }),
};

const deleteVenue = {
    params: Joi.object({ id: Joi.number().integer().required(), force: Joi.boolean().default(false) }),
};

const listVenues = {
    params: Joi.object({
        search: Joi.string().trim().max(200).allow('', null),
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(200).default(25),
        sort_by: Joi.string().valid('venue', 'stage', 'created_at', 'updated_at').default('created_at'),
        sort_dir: Joi.string().valid('asc', 'desc').default('asc'),
    }),
};

const deleteManyVenues = {
    params: Joi.object({ ids: Joi.array().items(Joi.number().integer()).min(1).required(), force: Joi.boolean().default(false) }),
};

export default {
    createVenue,
    updateVenue,
    getVenue,
    deleteVenue,
    listVenues,
    deleteManyVenues,
};