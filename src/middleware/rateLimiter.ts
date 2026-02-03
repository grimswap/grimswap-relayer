/**
 * Rate limiter middleware
 */

import { RateLimiterMemory } from "rate-limiter-flexible";
import { Request, Response, NextFunction } from "express";
import { RATE_LIMIT_CONFIG } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

const rateLimiter = new RateLimiterMemory({
  points: RATE_LIMIT_CONFIG.REQUESTS_PER_MINUTE,
  duration: 60, // Per minute
  blockDuration: RATE_LIMIT_CONFIG.BLOCK_DURATION,
});

export async function rateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  try {
    await rateLimiter.consume(ip);
    next();
  } catch (rateLimiterRes) {
    logger.warn(`Rate limit exceeded for IP: ${ip}`);
    res.status(429).json({
      error: "Too many requests",
      retryAfter: Math.ceil((rateLimiterRes as any).msBeforeNext / 1000),
    });
  }
}

export { rateLimiterMiddleware as rateLimiter };
