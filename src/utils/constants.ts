/**
 * Constants for the relayer service
 */

import { defineChain } from "viem";

// Unichain Sepolia configuration
export const unichainSepolia = defineChain({
  id: 1301,
  name: "Unichain Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://sepolia.unichain.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Uniscan",
      url: "https://sepolia.uniscan.xyz",
    },
  },
  testnet: true,
});

// Unichain Mainnet configuration
export const unichainMainnet = defineChain({
  id: 130,
  name: "Unichain",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://mainnet.unichain.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Uniscan",
      url: "https://uniscan.xyz",
    },
  },
  testnet: false,
});

// Use testnet by default, mainnet in production
export const CHAIN_CONFIG = process.env.NODE_ENV === "production"
  ? unichainMainnet
  : unichainSepolia;

// Contract addresses
export const CONTRACTS = {
  // Unichain Sepolia (Testnet)
  POOL_MANAGER: process.env.POOL_MANAGER_ADDRESS || "0x00B036B58a818B1BC34d502D3fE730Db729e62AC",
  POOL_HELPER: process.env.POOL_HELPER_ADDRESS || "0x0f8113EfA5527346978534192a76C94a567cae42",
  GRIM_POOL: process.env.GRIM_POOL_ADDRESS || "0x023F6b2Bb485A9c77F1b3e4009E58064E53414b9",
  GRIM_SWAP_ZK: process.env.GRIM_SWAP_ZK_ADDRESS || "0xc52c297f4f0d0556b1cd69b655F23df2513eC0C4",
  VERIFIER: process.env.VERIFIER_ADDRESS || "0xF7D14b744935cE34a210D7513471a8E6d6e696a0",
};

// Relayer configuration
export const RELAYER_CONFIG = {
  // Default fee in basis points (0.1% = 10 bps)
  DEFAULT_FEE_BPS: Number(process.env.RELAYER_FEE_BPS) || 10,

  // Maximum fee in basis points (1% = 100 bps)
  MAX_FEE_BPS: 100,

  // Minimum ETH balance to maintain
  MIN_BALANCE_ETH: BigInt(process.env.MIN_BALANCE_WEI || "100000000000000000"), // 0.1 ETH

  // Gas buffer percentage
  GAS_BUFFER_PERCENT: 20,
};

// Rate limiting configuration
export const RATE_LIMIT_CONFIG = {
  // Requests per minute per IP
  REQUESTS_PER_MINUTE: 10,

  // Burst limit
  BURST_LIMIT: 5,

  // Block duration in seconds
  BLOCK_DURATION: 60,
};
