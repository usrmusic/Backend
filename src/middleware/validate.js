import Joi from 'joi';
import AppError from '../utils/AppError.js';

const pick = (obj = {}, keys = []) =>
  keys.reduce((acc, k) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});

const validate = (schema = {}) => (req, res, next) => {
  try {
    // If a Joi schema object is passed directly, validate against { params, query, body }
    if (schema && typeof schema.validate === 'function') {
      const joiSchema = schema.prefs({ errors: { label: 'key' }, abortEarly: false });
      // Only include the top-level keys the Joi schema actually expects. This
      // avoids injecting `params`/`query` when the schema only validates `body`.
      const described = typeof schema.describe === 'function' ? schema.describe() : null;
      const schemaKeys = described && described.keys ? Object.keys(described.keys) : ['params', 'query', 'body'];
      const obj = {};
      if (schemaKeys.includes('params')) obj.params = req.params || {};
      if (schemaKeys.includes('query')) obj.query = req.query || {};
      if (schemaKeys.includes('body')) obj.body = req.body || {};

      if (req.files && obj.body && typeof obj.body === 'object') {
        Object.keys(req.files).forEach((f) => {
          const entry = req.files[f];
          if (Array.isArray(entry) && entry.length) obj.body[f] = entry[0].originalname || 'file';
        });
      }

      console.log('[validate] validating object keys:', Object.keys(obj), 'body keys:', obj.body ? Object.keys(obj.body) : null);
      const { value, error } = joiSchema.validate(obj);
      if (error) console.log('[validate] Joi validation error details:', error.details.map((d) => d.message));

      if (error) {
        const errorMessage = error.details.map((d) => d.message).join(', ');
        return next(new AppError(errorMessage, 400));
      }

      Object.assign(req, value);
      return next();
    }

    // Backwards-compatible behavior for plain descriptor objects
    const validSchema = pick(schema, ['params', 'query', 'body']);
    const obj = {};
    if (validSchema.params) obj.params = req.params || {};
    if (validSchema.query) obj.query = req.query || {};
    if (validSchema.body) obj.body = req.body || {};

    if (req.files && obj.body && typeof obj.body === 'object') {
      Object.keys(req.files).forEach((f) => {
        const entry = req.files[f];
        if (Array.isArray(entry) && entry.length) obj.body[f] = entry[0].originalname || 'file';
      });
    }

    const joiSchema = Joi.object(validSchema).prefs({ errors: { label: 'key' }, abortEarly: false });
    console.log('[validate] validating object keys:', Object.keys(obj), 'body keys:', obj.body ? Object.keys(obj.body) : null);
    const { value, error } = joiSchema.validate(obj);
    if (error) console.log('[validate] Joi validation error details:', error.details.map((d) => d.message));

    if (error) {
      const errorMessage = error.details.map((d) => d.message).join(', ');
      return next(new AppError(errorMessage, 400));
    }

    Object.assign(req, value);
    return next();
  } catch (err) {
    return next(err);
  }
};

export default validate;
