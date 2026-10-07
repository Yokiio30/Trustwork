const { Router } = require("express");

module.exports = (ctx) => {
  const r = Router();

  r.get("/health", (req, res) => {
    res.json({ ok: true, network: ctx.deployment.network, chainId: ctx.chainId, indexer: ctx.indexer.status() });
  });

  // Contract addresses and protocol parameters for the frontend. ABIs only on request.
  r.get("/config", (req, res) => {
    const contracts = {};
    for (const [name, c] of Object.entries(ctx.deployment.contracts)) {
      contracts[name] = { address: c.address, startBlock: c.startBlock };
      if (req.query.abi === "true") contracts[name].abi = c.abi;
    }
    res.json({
      network: ctx.deployment.network,
      chainId: ctx.chainId,
      contracts,
      params: ctx.deployment.config,
    });
  });

  return r;
};
