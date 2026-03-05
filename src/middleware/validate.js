import Joi from 'joi';
import ApiError from '../utils/ApiError.js';

const pick = (obj = {}, keys = []) =>
  keys.reduce((acc, k) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});

const validate = (schema = {}) => (req, res, next) => {
  try {
    const validSchema = pick(schema, ['params', 'query', 'body']);
    const obj = pick(req, Object.keys(validSchema));
    // If multer parsed files, merge presence of file fields into body so Joi can validate them
    if (req.files && obj.body && typeof obj.body === 'object') {
      // For each file field (e.g. company_logo) set the body value to the original filename so Joi sees a string
      Object.keys(req.files).forEach((f) => {
        const entry = req.files[f];
        if (Array.isArray(entry) && entry.length) obj.body[f] = entry[0].originalname || 'file';
      });
    }

    const joiSchema = Joi.object(validSchema).prefs({ errors: { label: 'key' }, abortEarly: false });
    const { value, error } = joiSchema.validate(obj);

    if (error) {
      const errorMessage = error.details.map((d) => d.message).join(', ');
      return next(new ApiError(400, errorMessage));
    }

    Object.assign(req, value);
    return next();
  } catch (err) {
    return next(err);
  }
};

export default validate;
