/**
 * Status Route
 *
 * Check transaction status and relayer info
 */

import { Router, Request, Response } from "express";
import { createPublicClient, http, type Hex } from "viem";
import { CHAIN_CONFIG, CONTRACTS } from "../utils/constants.js";
import { relayService } from "../services/relayService.js";
import { logger } from "../utils/logger.js";

export const statusRouter = Router();

const publicClient = createPublicClient({
  chain: CHAIN_CONFIG,
  transport: http(process.env.RPC_URL),
});

/**
 * GET /status/:txHash
 *
 * Get status of a transaction
 */
statusRouter.get("/:txHash", async (req: Request, res: Response) => {
  const { txHash } = req.params;

  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: "Invalid transaction hash" });
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as Hex,
    });

    if (receipt) {
      res.json({
        status: receipt.status === "success" ? "confirmed" : "failed",
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
      });
    } else {
      // Transaction pending
      const tx = await publicClient.getTransaction({
        hash: txHash as Hex,
      });

      if (tx) {
        res.json({
          status: "pending",
          nonce: tx.nonce,
        });
      } else {
        res.status(404).json({ error: "Transaction not found" });
      }
    }
  } catch (error) {
    logger.error("Status check failed:", error);
    res.status(500).json({ error: "Failed to check status" });
  }
});

/**
 * GET /status/relayer/info
 *
 * Get relayer information
 */
statusRouter.get("/relayer/info", async (req: Request, res: Response) => {
  try {
    const balance = await relayService.getBalance();

    res.json({
      chain: CHAIN_CONFIG.name,
      chainId: CHAIN_CONFIG.id,
      contracts: {
        poolManager: CONTRACTS.POOL_MANAGER,
        grimPool: CONTRACTS.GRIM_POOL,
        grimSwapZK: CONTRACTS.GRIM_SWAP_ZK,
      },
      relayerBalance: balance.toString(),
      healthy: balance > BigInt("10000000000000000"), // > 0.01 ETH
    });
  } catch (error) {
    logger.error("Relayer info failed:", error);
    res.status(500).json({ error: "Failed to get relayer info" });
  }
});
