const { ZodError } = require("zod");

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (msg, code = "BAD_REQUEST") => new AppError(400, code, msg);
const unauthorized = (msg = "Authentication required") => new AppError(401, "UNAUTHORIZED", msg);
const forbidden = (msg = "You do not have permission to do this") => new AppError(403, "FORBIDDEN", msg);
const unavailable = (msg = "Service temporarily unavailable. Please try again.") => new AppError(503, "UNAVAILABLE", msg);
const notFound = (msg = "Not found") => new AppError(404, "NOT_FOUND", msg);

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "Malformed JSON body" } });
  }
  console.error("[error]", req.method, req.path, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, unavailable, notFoundHandler, errorHandler };
