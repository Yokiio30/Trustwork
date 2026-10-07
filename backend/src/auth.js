// Wallet-based login: the server issues a one-time nonce, the user signs it in MetaMask,
// the server verifies the signature and returns a short-lived JWT. Roles are never stored in
// the token; they are read from the indexed on-chain role grants on every request.
const crypto = require("crypto");
const { ethers } = require("ethers");
const jwt = require("jsonwebtoken");
const config = require("./config");
const { unauthorized, forbidden } = require("./errors");
const { ROLE_HASH } = require("./indexer");

const NONCE_TTL_SECONDS = 300;

function buildMessage({ address, nonce, issuedAt, chainId, domain }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to TrustWork. This request does not cost gas or move any funds.",
    "",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt * 1000).toISOString()}`,
  ].join("\n");
}

function issueNonce(ctx, address, domain) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  ctx.db
    .prepare("INSERT INTO auth_nonces(address, nonce, expires_at) VALUES(?,?,?) ON CONFLICT(address) DO UPDATE SET nonce = excluded.nonce, expires_at = excluded.expires_at")
    .run(address, nonce, now + NONCE_TTL_SECONDS);
  const message = buildMessage({ address: ethers.getAddress(address), nonce, issuedAt: now, chainId: ctx.chainId, domain });
  return { nonce, message, expiresAt: now + NONCE_TTL_SECONDS };
}

function verifyLogin(ctx, address, signature, domain) {
  const row = ctx.db.prepare("SELECT nonce, expires_at FROM auth_nonces WHERE address = ?").get(address);
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.expires_at < now) throw unauthorized("Login challenge expired. Request a new one.");

  const message = buildMessage({
    address: ethers.getAddress(address),
    nonce: row.nonce,
    issuedAt: row.expires_at - NONCE_TTL_SECONDS,
    chainId: ctx.chainId,
    domain,
  });

  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature).toLowerCase();
  } catch {
    throw unauthorized("Invalid signature");
  }
  if (recovered !== address) throw unauthorized("Signature does not match the address");

  // single use
  ctx.db.prepare("DELETE FROM auth_nonces WHERE address = ?").run(address);
}

function signToken(address) {
  return jwt.sign({}, config.jwtSecret, { subject: address, expiresIn: config.jwtTtl, algorithm: "HS256" });
}

function readToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ["HS256"] });
    return String(payload.sub).toLowerCase();
  } catch {
    return null;
  }
}

/** Roles come from indexed RoleGranted/RoleRevoked events. */
function rolesOf(ctx, address) {
  const has = (contract, role) =>
    !!ctx.db.prepare("SELECT 1 FROM roles WHERE contract = ? AND role = ? AND account = ?").get(contract, role, address);
  const roles = ["user"];
  if (has("JobEscrow", ROLE_HASH.ADMIN)) roles.push("admin");
  if (has("JobEscrow", ROLE_HASH.AUDITOR)) roles.push("auditor");
  if (has("DisputeResolution", ROLE_HASH.ARBITER)) roles.push("arbiter");
  return roles;
}

function authMiddleware(ctx) {
  const optional = (req, res, next) => {
    const address = readToken(req);
    if (address) {
      req.user = { address, roles: rolesOf(ctx, address) };
    }
    next();
  };
  const required = (req, res, next) => {
    const address = readToken(req);
    if (!address) throw unauthorized();
    req.user = { address, roles: rolesOf(ctx, address) };
    next();
  };
  const requireRole =
    (...allowed) =>
    (req, res, next) => {
      if (!req.user) throw unauthorized();
      if (!req.user.roles.some((r) => allowed.includes(r))) throw forbidden(`Requires role: ${allowed.join(" or ")}`);
      next();
    };
  return { optional, required, requireRole };
}

module.exports = { issueNonce, verifyLogin, signToken, rolesOf, authMiddleware };
