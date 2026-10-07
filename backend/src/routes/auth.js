const { Router } = require("express");
const { z, address } = require("./util");
const { issueNonce, verifyLogin, signToken, rolesOf } = require("../auth");

module.exports = (ctx, mw) => {
  const r = Router();

  // The frontend sends its own origin domain back in /login so both sides build the same message.
  r.get("/nonce", (req, res) => {
    const q = z.object({ address, domain: z.string().max(200).optional() }).parse(req.query);
    const domain = q.domain || req.hostname;
    res.json({ ...issueNonce(ctx, q.address, domain), domain });
  });

  r.post("/login", (req, res) => {
    const body = z.object({ address, signature: z.string().min(10).max(200), domain: z.string().max(200) }).parse(req.body);
    verifyLogin(ctx, body.address, body.signature, body.domain);
    res.json({ token: signToken(body.address), address: body.address, roles: rolesOf(ctx, body.address) });
  });

  r.get("/me", mw.required, (req, res) => {
    res.json({ address: req.user.address, roles: req.user.roles });
  });

  return r;
};
