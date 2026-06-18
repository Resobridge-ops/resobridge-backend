// Standardized error response handler
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Standardized error response format
const errorResponse = (statusCode, message, details = null) => {
  return {
    success: false,
    statusCode,
    message,
    ...(details && { details })
  };
};

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(
      errorResponse(err.statusCode, err.message, err.details)
    );
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(403).json(
      errorResponse(403, 'Invalid token')
    );
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json(
      errorResponse(401, 'Token expired')
    );
  }

  // Handle MongoDB validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json(
      errorResponse(400, 'Validation error', messages)
    );
  }

  // Handle MongoDB duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json(
      errorResponse(400, `${field} already exists`)
    );
  }

  // Default server error
  res.status(500).json(
    errorResponse(500, 'Internal server error')
  );
};

module.exports = {
  ApiError,
  errorResponse,
  errorHandler
};
