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

// Contract addresses (V3 - Dual-Mode Hook + Router)
export const CONTRACTS = {
  // Unichain Sepolia (Testnet)
  POOL_MANAGER: process.env.POOL_MANAGER_ADDRESS || "0x00B036B58a818B1BC34d502D3fE730Db729e62AC",
  POOL_HELPER: process.env.POOL_HELPER_ADDRESS || "0xbb09116f3661eb46791Ee8eFfF0e32D2d621866c",
  POOL_SWAP_TEST: process.env.POOL_SWAP_TEST_ADDRESS || "0x9140a78c1A137c7fF1c151EC8231272aF78a99A4",
  GRIM_POOL: process.env.GRIM_POOL_ADDRESS || "0xEAB5E7B4e715A22E8c114B7476eeC15770B582bb",
  GRIM_SWAP_ZK: process.env.GRIM_SWAP_ZK_ADDRESS || "0x3bee7D1A5914d1ccD34D2a2d00C359D0746400C4", // NEW: fee=3000, tickSpacing=60
  GRIM_SWAP_ROUTER: process.env.GRIM_SWAP_ROUTER_ADDRESS || "0xC13a6a504da21aD23c748f08d3E991621D42DA4F",
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

  // ETH funding for stealth addresses (covers ~2 transactions for claiming)
  // This enables the stealth address to send tokens without the user needing ETH
  STEALTH_FUNDING_WEI: BigInt(process.env.STEALTH_FUNDING_WEI || "500000000000000"), // 0.0005 ETH (~$1 worth of gas)

  // Whether to fund stealth addresses after successful swaps
  ENABLE_STEALTH_FUNDING: process.env.ENABLE_STEALTH_FUNDING !== "false",
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
