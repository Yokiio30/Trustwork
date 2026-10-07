const { z } = require("zod");
const { ethers } = require("ethers");

const address = z
  .string()
  .refine((v) => ethers.isAddress(v), "Invalid Ethereum address")
  .transform((v) => v.toLowerCase());

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const id = z.coerce.number().int().min(1);

module.exports = { address, pagination, id, z };
