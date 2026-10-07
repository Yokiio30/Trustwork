const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const { authMiddleware } = require("./auth");
const { notFoundHandler, errorHandler } = require("./errors");

function createApp(ctx) {
  const app = express();
  app.set("trust proxy", 1); // behind Render/Vercel/nginx
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, maxAge: 600 }));
  app.use(express.json({ limit: "32kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  const mw = authMiddleware(ctx);
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

  const api = express.Router();
  api.use(require("./routes/meta")(ctx));
  api.use("/auth", authLimiter, require("./routes/auth")(ctx, mw));
  api.use(require("./routes/jobs")(ctx, mw));
  api.use(require("./routes/activity")(ctx));
  api.use(require("./routes/stats")(ctx));
  api.use(require("./routes/users")(ctx));
  api.use(require("./routes/documents")(ctx, mw));
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
