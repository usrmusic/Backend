class ApiError extends Error {
  constructor(statusCode = 500, message = 'Internal Server Error') {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export default ApiError;
