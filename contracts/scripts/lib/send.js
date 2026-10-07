// Public RPC nodes only allow one in-flight transaction for "delegated" (EIP-7702) accounts, and can lag a
// moment behind the block that mined the previous one. These helpers retry a send that hits that limit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /in-flight transaction limit|replacement transaction underpriced|nonce too low|already known/i;

/** Retry only the *sending* step, never the waiting step, so a mined transaction is never sent twice. */
async function retry(fn, { tries = 8, delayMs = 4000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e.shortMessage || e.message || "";
      if (i >= tries || !RETRYABLE.test(msg)) throw e;
      console.log(`  node asked us to wait (${msg.slice(0, 60)}), retrying in ${(delayMs / 1000) | 0}s (${i}/${tries - 1})`);
      await sleep(delayMs);
    }
  }
}

/** Send a transaction (retrying if the node is busy), then wait for it to be mined. */
async function send(fn, opts) {
  const tx = await retry(fn, opts);
  return tx.wait();
}

module.exports = { retry, send, sleep };
