import Joi from 'joi';

export default function validate(schema) {
  return (req, res, next) => {
    const opts = { abortEarly: false, allowUnknown: true, stripUnknown: true };
    const { error, value } = schema.validate(req.body, opts);
    if (error) {
      return res.status(400).json({ error: 'validation_error', details: error.details.map(d => d.message) });
    }
    req.validated = value;
    next();
  };
}
