/**
 * Relay Service
 *
 * Handles blockchain interactions for submitting private swaps
 */

import { config } from "dotenv";
// Load env vars before anything else
config();

import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../utils/logger.js";
import { CONTRACTS, CHAIN_CONFIG } from "../utils/constants.js";

// Pool Helper ABI for swap (routes through PoolManager)
const POOL_HELPER_ABI = [
  {
    type: "function",
    name: "swap",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "amountSpecified", type: "int256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "hookData", type: "bytes" },
      { name: "from", type: "address" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
    stateMutability: "nonpayable",
  },
] as const;

interface RelayParams {
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

interface RelayResult {
  txHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  relayerFee: string;
}

interface EstimateResult {
  gas: bigint;
  fee: bigint;
  relayerFee: string;
  totalCost: string;
}

class RelayService {
  private walletClient;
  private publicClient;
  private account;

  /**
   * Get the relayer's address
   */
  getAddress(): string {
    return this.account.address;
  }

  constructor() {
    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("RELAYER_PRIVATE_KEY not set");
    }

    this.account = privateKeyToAccount(privateKey as Hex);

    this.publicClient = createPublicClient({
      chain: CHAIN_CONFIG,
      transport: http(process.env.RPC_URL),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: CHAIN_CONFIG,
      transport: http(process.env.RPC_URL),
    });

    logger.info(`Relayer initialized with address: ${this.account.address}`);
  }

  /**
   * Get relayer's ETH balance
   */
  async getBalance(): Promise<bigint> {
    return this.publicClient.getBalance({
      address: this.account.address,
    });
  }

  /**
   * Encode the ZK proof as hookData
   */
  private encodeHookData(proof: RelayParams["proof"], publicSignals: string[]): Hex {
    // Convert proof to contract format
    const pA: [bigint, bigint] = [BigInt(proof.a[0]), BigInt(proof.a[1])];
    // Note: pB needs to be swapped for the contract format
    const pB: [[bigint, bigint], [bigint, bigint]] = [
      [BigInt(proof.b[0][1]), BigInt(proof.b[0][0])],
      [BigInt(proof.b[1][1]), BigInt(proof.b[1][0])],
    ];
    const pC: [bigint, bigint] = [BigInt(proof.c[0]), BigInt(proof.c[1])];
    const signals = publicSignals.map((s) => BigInt(s)) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

    // ABI encode the proof data
    const hookData = encodeAbiParameters(
      parseAbiParameters("uint256[2], uint256[2][2], uint256[2], uint256[8]"),
      [pA, pB, pC, signals]
    );

    return hookData;
  }

  /**
   * Submit a private swap transaction
   */
  async submitPrivateSwap(params: RelayParams): Promise<RelayResult> {
    const { proof, publicSignals, swapParams } = params;

    logger.info("Preparing transaction...");

    // Encode hook data
    const hookData = this.encodeHookData(proof, publicSignals);

    // Prepare pool key
    const poolKey = {
      currency0: swapParams.poolKey.currency0 as Address,
      currency1: swapParams.poolKey.currency1 as Address,
      fee: swapParams.poolKey.fee,
      tickSpacing: swapParams.poolKey.tickSpacing,
      hooks: swapParams.poolKey.hooks as Address,
    };

    const poolHelperAddress = CONTRACTS.POOL_HELPER as Address;

    // Estimate gas
    const gasEstimate = await this.publicClient.estimateGas({
      account: this.account.address,
      to: poolHelperAddress,
      data: encodeFunctionData({
        abi: POOL_HELPER_ABI,
        functionName: "swap",
        args: [
          poolKey,
          swapParams.zeroForOne,
          BigInt(swapParams.amountSpecified),
          BigInt(swapParams.sqrtPriceLimitX96),
          hookData,
          this.account.address, // from address (relayer)
        ],
      }),
    });

    logger.info(`Gas estimate: ${gasEstimate}`);

    // Add 20% buffer to gas estimate
    const gasLimit = (gasEstimate * 120n) / 100n;

    // Submit transaction
    const txHash = await this.walletClient.sendTransaction({
      to: poolHelperAddress,
      data: encodeFunctionData({
        abi: POOL_HELPER_ABI,
        functionName: "swap",
        args: [
          poolKey,
          swapParams.zeroForOne,
          BigInt(swapParams.amountSpecified),
          BigInt(swapParams.sqrtPriceLimitX96),
          hookData,
          this.account.address,
        ],
      }),
      gas: gasLimit,
    });

    logger.info(`Transaction submitted: ${txHash}`);

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

    logger.info(`Transaction confirmed in block ${receipt.blockNumber}`);

    // Calculate relayer fee (from public signals)
    const relayerFeeBps = BigInt(publicSignals[4]);
    const swapAmount = BigInt(swapParams.amountSpecified);
    const relayerFee = (swapAmount * relayerFeeBps) / 10000n;

    return {
      txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      relayerFee: relayerFee.toString(),
    };
  }

  /**
   * Estimate gas and fee for a relay request
   */
  async estimateRelay(params: RelayParams): Promise<EstimateResult> {
    const { proof, publicSignals, swapParams } = params;

    const hookData = this.encodeHookData(proof, publicSignals);

    const poolKey = {
      currency0: swapParams.poolKey.currency0 as Address,
      currency1: swapParams.poolKey.currency1 as Address,
      fee: swapParams.poolKey.fee,
      tickSpacing: swapParams.poolKey.tickSpacing,
      hooks: swapParams.poolKey.hooks as Address,
    };

    const poolHelperAddress = CONTRACTS.POOL_HELPER as Address;

    const gasEstimate = await this.publicClient.estimateGas({
      account: this.account.address,
      to: poolHelperAddress,
      data: encodeFunctionData({
        abi: POOL_HELPER_ABI,
        functionName: "swap",
        args: [
          poolKey,
          swapParams.zeroForOne,
          BigInt(swapParams.amountSpecified),
          BigInt(swapParams.sqrtPriceLimitX96),
          hookData,
          this.account.address,
        ],
      }),
    });

    const gasPrice = await this.publicClient.getGasPrice();
    const gasCost = gasEstimate * gasPrice;

    const relayerFeeBps = BigInt(publicSignals[4]);
    const swapAmount = BigInt(swapParams.amountSpecified);
    const relayerFee = (swapAmount * relayerFeeBps) / 10000n;

    return {
      gas: gasEstimate,
      fee: gasCost,
      relayerFee: relayerFee.toString(),
      totalCost: (gasCost + relayerFee).toString(),
    };
  }
}

export const relayService = new RelayService();
