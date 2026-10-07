import { Contract, Interface } from "ethers";
import { api } from "./api";

export function contractFor(config, name, runner) {
  const c = config.contracts[name];
  return new Contract(c.address, c.abi, runner);
}

/** Find a decoded event in a receipt for one of our contracts. */
export function findEvent(config, contractName, receipt, eventName) {
  const c = config.contracts[contractName];
  const iface = new Interface(c.abi);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== c.address.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === eventName) return parsed;
    } catch {
      /* not one of ours */
    }
  }
  return null;
}

/** The API reads from an indexer that trails the chain; wait until it has seen our block. */
// On a public testnet (12 s blocks) the indexer may lag by a few confirmations, so allow a minute.
export async function waitForIndexer(blockNumber, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await api("/health");
      if (h.indexer.lastBlock !== null && h.indexer.lastBlock >= blockNumber) return true;
    } catch {
      /* keep trying */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}
