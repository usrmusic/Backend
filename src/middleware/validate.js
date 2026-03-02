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
