import Joi from "joi";

const listFiles = Joi.object({
  params: Joi.object({
    search: Joi.string().trim().max(200).allow("", null),
    page: Joi.number().integer().min(1).default(1),
    perPage: Joi.number().integer().min(1).max(100).default(25),
    sort: Joi.string().optional(),
  }),
});

const uploadfile = Joi.object({
  // Expect multipart file via multer; validate body fields used when creating DB record
  body: Joi.object({
    event_id: Joi.number().integer().optional().allow(null),
    general: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true','false')).optional(),
    // allow ISO date, null, or empty string (clients may submit empty value)
    delete_after: Joi.date().iso().optional().allow(null, ''),
    folder: Joi.string().trim().max(100).optional(),
  }).unknown(true),

});

const getFile = Joi.object({
    params: Joi.object({ id: Joi.number().integer().required() }),
});

const downloadFile = Joi.object({
    params: Joi.object({ id: Joi.number().integer().required() }),
});

const deleteFile = Joi.object({
    params: Joi.object({ id: Joi.number().integer().required() }),
});

const updateFileMetadata = Joi.object({
    params: Joi.object({ id: Joi.number().integer().required() }),
    body: Joi.object({
        file_name: Joi.string().trim().max(255).optional(),
    })
});

export default {
  listFiles,
  uploadfile,
  getFile,
  downloadFile,
  deleteFile,
  updateFileMetadata,
};
