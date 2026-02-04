/**
 * GrimSwap Relayer Service
 *
 * Accepts ZK proofs from users and submits them to the blockchain,
 * hiding the user's identity by paying gas on their behalf.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "dotenv";
import { relayRouter } from "./routes/relay.js";
import { statusRouter } from "./routes/status.js";
import { feeRouter } from "./routes/fee.js";
import { logger } from "./utils/logger.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import { relayService } from "./services/relayService.js";
import { CHAIN_CONFIG, RELAYER_CONFIG } from "./utils/constants.js";

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
  methods: ["GET", "POST"],
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimiter);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Relayer info - returns address for proof generation
app.get("/info", async (req, res) => {
  try {
    const balance = await relayService.getBalance();
    res.json({
      address: relayService.getAddress(),
      chain: CHAIN_CONFIG.name,
      chainId: CHAIN_CONFIG.id,
      feeBps: RELAYER_CONFIG.DEFAULT_FEE_BPS,
      balance: balance.toString(),
    });
  } catch (error) {
    logger.error("Info endpoint failed:", error);
    res.status(500).json({ error: "Failed to get relayer info" });
  }
});

// API Routes
app.use("/relay", relayRouter);
app.use("/status", statusRouter);
app.use("/fee", feeRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Start server
app.listen(PORT, () => {
  logger.info(`GrimSwap Relayer running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;
