/**
 * Request validation middleware
 */

import { Request, Response, NextFunction } from "express";

/**
 * Validate relay request body
 */
export function validateRelayRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { proof, publicSignals, swapParams } = req.body;

  // Validate proof structure
  if (!proof || typeof proof !== "object") {
    res.status(400).json({ error: "Missing or invalid proof" });
    return;
  }

  if (!Array.isArray(proof.a) || proof.a.length !== 2) {
    res.status(400).json({ error: "Invalid proof.a" });
    return;
  }

  if (!Array.isArray(proof.b) || proof.b.length !== 2) {
    res.status(400).json({ error: "Invalid proof.b" });
    return;
  }

  if (!Array.isArray(proof.c) || proof.c.length !== 2) {
    res.status(400).json({ error: "Invalid proof.c" });
    return;
  }

  // Validate public signals
  if (!Array.isArray(publicSignals) || publicSignals.length < 6) {
    res.status(400).json({
      error: "Invalid publicSignals: expected array with at least 6 elements",
    });
    return;
  }

  // Validate each public signal is a valid number string
  for (let i = 0; i < publicSignals.length; i++) {
    if (typeof publicSignals[i] !== "string") {
      res.status(400).json({
        error: `Invalid publicSignals[${i}]: expected string`,
      });
      return;
    }
    try {
      BigInt(publicSignals[i]);
    } catch {
      res.status(400).json({
        error: `Invalid publicSignals[${i}]: not a valid number`,
      });
      return;
    }
  }

  // Validate swap params
  if (!swapParams || typeof swapParams !== "object") {
    res.status(400).json({ error: "Missing or invalid swapParams" });
    return;
  }

  if (!swapParams.poolKey || typeof swapParams.poolKey !== "object") {
    res.status(400).json({ error: "Missing or invalid swapParams.poolKey" });
    return;
  }

  const { currency0, currency1, fee, tickSpacing, hooks } = swapParams.poolKey;

  if (!isValidAddress(currency0)) {
    res.status(400).json({ error: "Invalid currency0 address" });
    return;
  }

  if (!isValidAddress(currency1)) {
    res.status(400).json({ error: "Invalid currency1 address" });
    return;
  }

  if (!isValidAddress(hooks)) {
    res.status(400).json({ error: "Invalid hooks address" });
    return;
  }

  if (typeof fee !== "number" || fee < 0) {
    res.status(400).json({ error: "Invalid fee" });
    return;
  }

  if (typeof tickSpacing !== "number") {
    res.status(400).json({ error: "Invalid tickSpacing" });
    return;
  }

  if (typeof swapParams.zeroForOne !== "boolean") {
    res.status(400).json({ error: "Invalid zeroForOne" });
    return;
  }

  if (!swapParams.amountSpecified) {
    res.status(400).json({ error: "Missing amountSpecified" });
    return;
  }

  if (!swapParams.sqrtPriceLimitX96) {
    res.status(400).json({ error: "Missing sqrtPriceLimitX96" });
    return;
  }

  next();
}

/**
 * Check if a string is a valid Ethereum address
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}
