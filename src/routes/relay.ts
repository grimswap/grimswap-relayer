/**
 * Relay Route
 *
 * Accepts ZK proofs and submits them to the GrimSwapZK contract
 */

import { Router, Request, Response } from "express";
import { relayService } from "../services/relayService.js";
import { validateRelayRequest } from "../middleware/validator.js";
import { logger } from "../utils/logger.js";

export const relayRouter = Router();

interface RelayRequest {
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  publicSignals: string[];
  swapParams: {
    poolKey: {
      currency0: string;
      currency1: string;
      fee: number;
      tickSpacing: number;
      hooks: string;
    };
    zeroForOne: boolean;
    amountSpecified: string;
    sqrtPriceLimitX96: string;
  };
}

/**
 * POST /relay
 *
 * Submit a private swap through the relayer
 */
relayRouter.post("/", validateRelayRequest, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);

  logger.info(`[${requestId}] Relay request received`);

  try {
    const { proof, publicSignals, swapParams } = req.body as RelayRequest;

    // Extract recipient from public signals for logging
    const recipient = publicSignals[2];
    logger.info(`[${requestId}] Recipient: ${recipient.slice(0, 10)}...`);

    // Submit to blockchain
    const result = await relayService.submitPrivateSwap({
      proof,
      publicSignals,
      swapParams,
    });

    const duration = Date.now() - startTime;
    logger.info(`[${requestId}] Relay successful in ${duration}ms. TxHash: ${result.txHash}`);

    res.json({
      success: true,
      txHash: result.txHash,
      blockNumber: result.blockNumber.toString(),
      gasUsed: result.gasUsed.toString(),
      relayerFee: result.relayerFee,
      requestId,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[${requestId}] Relay failed after ${duration}ms:`, error);

    if (error instanceof Error) {
      // Handle known errors
      if (error.message.includes("InvalidProof")) {
        return res.status(400).json({
          success: false,
          error: "Invalid ZK proof",
          code: "INVALID_PROOF",
          requestId,
        });
      }
      if (error.message.includes("NullifierAlreadyUsed")) {
        return res.status(400).json({
          success: false,
          error: "This deposit has already been spent",
          code: "NULLIFIER_USED",
          requestId,
        });
      }
      if (error.message.includes("InvalidMerkleRoot")) {
        return res.status(400).json({
          success: false,
          error: "Invalid or outdated Merkle root",
          code: "INVALID_ROOT",
          requestId,
        });
      }
      if (error.message.includes("insufficient funds")) {
        return res.status(503).json({
          success: false,
          error: "Relayer has insufficient funds",
          code: "RELAYER_UNDERFUNDED",
          requestId,
        });
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: "Failed to relay transaction",
      details: errorMessage.slice(0, 500),
      code: "RELAY_FAILED",
      requestId,
    });
  }
});

/**
 * POST /relay/estimate
 *
 * Estimate gas and fee for a relay request without submitting
 */
relayRouter.post("/estimate", validateRelayRequest, async (req: Request, res: Response) => {
  try {
    const { proof, publicSignals, swapParams } = req.body as RelayRequest;

    const estimate = await relayService.estimateRelay({
      proof,
      publicSignals,
      swapParams,
    });

    res.json({
      success: true,
      estimatedGas: estimate.gas.toString(),
      estimatedFee: estimate.fee.toString(),
      relayerFee: estimate.relayerFee,
      totalCost: estimate.totalCost,
    });
  } catch (error) {
    logger.error("Estimate failed:", error);
    res.status(500).json({
      success: false,
      error: "Failed to estimate transaction",
    });
  }
});
