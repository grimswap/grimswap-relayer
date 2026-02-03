/**
 * Fee Route
 *
 * Get current relayer fee information
 */

import { Router, Request, Response } from "express";
import { createPublicClient, http, formatEther } from "viem";
import { CHAIN_CONFIG, RELAYER_CONFIG } from "../utils/constants.js";

export const feeRouter = Router();

const publicClient = createPublicClient({
  chain: CHAIN_CONFIG,
  transport: http(process.env.RPC_URL),
});

/**
 * GET /fee
 *
 * Get current fee information
 */
feeRouter.get("/", async (req: Request, res: Response) => {
  try {
    const gasPrice = await publicClient.getGasPrice();

    // Estimate gas for a typical private swap
    const estimatedGas = BigInt(250000); // ~250k gas for ZK verification + swap
    const estimatedGasCost = gasPrice * estimatedGas;

    res.json({
      // Relayer fee in basis points
      relayerFeeBps: RELAYER_CONFIG.DEFAULT_FEE_BPS,
      relayerFeePercent: RELAYER_CONFIG.DEFAULT_FEE_BPS / 100,

      // Current gas prices
      gasPrice: gasPrice.toString(),
      gasPriceGwei: Number(gasPrice) / 1e9,

      // Estimated costs
      estimatedGas: estimatedGas.toString(),
      estimatedGasCostWei: estimatedGasCost.toString(),
      estimatedGasCostEth: formatEther(estimatedGasCost),

      // Network info
      chain: CHAIN_CONFIG.name,
      chainId: CHAIN_CONFIG.id,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get fee information" });
  }
});

/**
 * GET /fee/quote
 *
 * Get a fee quote for a specific swap amount
 */
feeRouter.get("/quote", async (req: Request, res: Response) => {
  const { amount } = req.query;

  if (!amount || typeof amount !== "string") {
    return res.status(400).json({ error: "Missing amount parameter" });
  }

  try {
    const amountBigInt = BigInt(amount);
    const gasPrice = await publicClient.getGasPrice();
    const estimatedGas = BigInt(250000);
    const gasCost = gasPrice * estimatedGas;

    // Calculate relayer fee
    const relayerFee = (amountBigInt * BigInt(RELAYER_CONFIG.DEFAULT_FEE_BPS)) / BigInt(10000);

    // Total cost
    const totalCost = gasCost + relayerFee;

    // Net amount after fees
    const netAmount = amountBigInt - relayerFee;

    res.json({
      inputAmount: amount,
      relayerFee: relayerFee.toString(),
      relayerFeeBps: RELAYER_CONFIG.DEFAULT_FEE_BPS,
      gasCostWei: gasCost.toString(),
      totalCost: totalCost.toString(),
      netAmount: netAmount.toString(),
      netAmountPercent: Number((netAmount * BigInt(10000)) / amountBigInt) / 100,
    });
  } catch (error) {
    res.status(400).json({ error: "Invalid amount" });
  }
});
