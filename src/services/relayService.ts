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
  decodeErrorResult,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../utils/logger.js";
import { CONTRACTS, CHAIN_CONFIG } from "../utils/constants.js";

// GrimPool ABI for checking Merkle root and adding roots
const GRIM_POOL_ABI = [
  {
    type: "function",
    name: "isKnownRoot",
    inputs: [{ name: "root", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nullifierHashes",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "addKnownRoot",
    inputs: [{ name: "root", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

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
   * Check if Merkle root is known by GrimPool
   */
  async isRootKnown(root: bigint): Promise<boolean> {
    const rootBytes32 = `0x${root.toString(16).padStart(64, '0')}` as Hex;
    try {
      const isKnown = await this.publicClient.readContract({
        address: CONTRACTS.GRIM_POOL as Address,
        abi: GRIM_POOL_ABI,
        functionName: "isKnownRoot",
        args: [rootBytes32],
      });
      return isKnown as boolean;
    } catch (error) {
      logger.warn("Failed to check root:", error);
      return false;
    }
  }

  /**
   * Check if nullifier has been used
   */
  async isNullifierUsed(nullifierHash: bigint): Promise<boolean> {
    const nullifierBytes32 = `0x${nullifierHash.toString(16).padStart(64, '0')}` as Hex;
    try {
      const isUsed = await this.publicClient.readContract({
        address: CONTRACTS.GRIM_POOL as Address,
        abi: GRIM_POOL_ABI,
        functionName: "nullifierHashes",
        args: [nullifierBytes32],
      });
      return isUsed as boolean;
    } catch (error) {
      logger.warn("Failed to check nullifier:", error);
      return false;
    }
  }

  /**
   * Check if relayer is the owner of GrimPool
   */
  async isOwner(): Promise<boolean> {
    try {
      const owner = await this.publicClient.readContract({
        address: CONTRACTS.GRIM_POOL as Address,
        abi: GRIM_POOL_ABI,
        functionName: "owner",
      });
      return (owner as string).toLowerCase() === this.account.address.toLowerCase();
    } catch (error) {
      logger.warn("Failed to check owner:", error);
      return false;
    }
  }

  /**
   * Add a known root to GrimPool (requires owner privileges)
   */
  async addKnownRoot(root: bigint): Promise<boolean> {
    const rootBytes32 = `0x${root.toString(16).padStart(64, '0')}` as Hex;
    try {
      const txHash = await this.walletClient.writeContract({
        address: CONTRACTS.GRIM_POOL as Address,
        abi: GRIM_POOL_ABI,
        functionName: "addKnownRoot",
        args: [rootBytes32],
      });

      logger.info(`Adding Merkle root ${rootBytes32.slice(0, 20)}... TxHash: ${txHash}`);

      await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      logger.info("Merkle root added successfully");
      return true;
    } catch (error) {
      logger.error("Failed to add root:", error);
      return false;
    }
  }

  /**
   * Submit a private swap transaction
   */
  async submitPrivateSwap(params: RelayParams): Promise<RelayResult> {
    const { proof, publicSignals, swapParams } = params;

    logger.info("Preparing transaction...");

    // Extract and validate public signals
    // Order: [0] computedCommitment, [1] computedNullifierHash,
    // [2] merkleRoot, [3] nullifierHash, [4] recipient, [5] relayer, [6] relayerFee, [7] swapAmountOut
    const merkleRoot = BigInt(publicSignals[2]);
    const nullifierHash = BigInt(publicSignals[3]);

    // Pre-flight checks
    logger.info("Checking Merkle root...");
    let isRootKnown = await this.isRootKnown(merkleRoot);

    if (!isRootKnown) {
      logger.info("Merkle root not found, checking if relayer can add it...");

      // If relayer is owner, try to add the root
      const canAddRoot = await this.isOwner();
      if (canAddRoot) {
        logger.info("Relayer is owner, adding Merkle root...");
        const added = await this.addKnownRoot(merkleRoot);
        if (added) {
          isRootKnown = true;
          logger.info("Merkle root added successfully");
        }
      }

      if (!isRootKnown) {
        throw new Error(`InvalidMerkleRoot: Root ${merkleRoot.toString().slice(0, 20)}... is not registered in GrimPool. Relayer cannot add roots (not owner).`);
      }
    }
    logger.info("Merkle root is valid");

    logger.info("Checking nullifier...");
    const isNullifierUsed = await this.isNullifierUsed(nullifierHash);
    if (isNullifierUsed) {
      throw new Error(`NullifierAlreadyUsed: This deposit has already been withdrawn`);
    }
    logger.info("Nullifier is valid (not used)");

    // Validate recipient address (should be a valid 20-byte address)
    const recipientSignal = BigInt(publicSignals[4]);
    const relayerSignal = BigInt(publicSignals[5]);
    const relayerFeeSignal = BigInt(publicSignals[6]);

    logger.info(`Recipient: 0x${recipientSignal.toString(16).padStart(40, '0')}`);
    logger.info(`Relayer: 0x${relayerSignal.toString(16).padStart(40, '0')}`);
    logger.info(`Relayer Fee: ${relayerFeeSignal} bps`);

    // Check if recipient looks valid (should be at least 16 bytes when used as address)
    if (recipientSignal === 0n) {
      throw new Error("InvalidRecipient: Recipient address is zero");
    }

    // Check relayer fee
    if (relayerFeeSignal > 1000n) {
      throw new Error(`InvalidRelayerFee: Fee ${relayerFeeSignal} exceeds max 1000 bps`);
    }

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

    const swapData = encodeFunctionData({
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
    });

    logger.info("Swap call data prepared, estimating gas...");
    logger.info(`Pool: ${poolKey.currency0} -> ${poolKey.currency1}`);
    logger.info(`Amount: ${swapParams.amountSpecified}, zeroForOne: ${swapParams.zeroForOne}`);

    // Estimate gas with better error handling
    let gasEstimate: bigint;
    try {
      gasEstimate = await this.publicClient.estimateGas({
        account: this.account.address,
        to: poolHelperAddress,
        data: swapData,
      });
    } catch (estimateError: any) {
      // Try to simulate the call to get more error details
      logger.error("Gas estimation failed, attempting simulation...");

      try {
        await this.publicClient.call({
          account: this.account.address,
          to: poolHelperAddress,
          data: swapData,
        });
      } catch (callError: any) {
        const errorMsg = callError?.message || callError?.toString() || "Unknown error";

        // Check for known contract errors
        if (errorMsg.includes("InvalidProof")) {
          throw new Error("InvalidProof: ZK proof verification failed in Groth16Verifier");
        }
        if (errorMsg.includes("InvalidMerkleRoot")) {
          throw new Error("InvalidMerkleRoot: Merkle root not recognized by GrimPool");
        }
        if (errorMsg.includes("NullifierAlreadyUsed")) {
          throw new Error("NullifierAlreadyUsed: This deposit has already been spent");
        }
        if (errorMsg.includes("InvalidRecipient")) {
          throw new Error("InvalidRecipient: Recipient address is invalid");
        }
        if (errorMsg.includes("InvalidRelayerFee")) {
          throw new Error("InvalidRelayerFee: Relayer fee exceeds maximum");
        }

        logger.error("Call simulation error:", errorMsg);
      }

      // Re-throw original error with more context
      throw new Error(`Contract reverted: ${estimateError?.shortMessage || estimateError?.message || "Unknown reason"}. Check proof validity and contract state.`);
    }

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
    // Public signals order: [0] computedCommitment, [1] computedNullifierHash,
    // [2] merkleRoot, [3] nullifierHash, [4] recipient, [5] relayer, [6] relayerFee, [7] swapAmountOut
    const relayerFeeBps = BigInt(publicSignals[6]);
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

    // Public signals order: [0] computedCommitment, [1] computedNullifierHash,
    // [2] merkleRoot, [3] nullifierHash, [4] recipient, [5] relayer, [6] relayerFee, [7] swapAmountOut
    const relayerFeeBps = BigInt(publicSignals[6]);
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
