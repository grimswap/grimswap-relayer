# GrimSwap Partner Integration Guide

Complete guide to integrating GrimSwap private swaps into your application.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Architecture](#architecture)
- [Integration Steps](#integration-steps)
  - [Step 1: Setup Circuit Files](#step-1-setup-circuit-files)
  - [Step 2: Deposit ETH](#step-2-deposit-eth)
  - [Step 3: Execute Private Swap](#step-3-execute-private-swap)
  - [Step 4: Verify Completion](#step-4-verify-completion)
- [Minimal Integration (One-Call)](#minimal-integration-one-call)
- [Advanced Usage](#advanced-usage)
  - [Manual Proof Generation](#manual-proof-generation)
  - [Stealth Addresses](#stealth-addresses)
  - [Custom Relayer](#custom-relayer)
  - [Reading Deposits](#reading-deposits)
- [Pool Configuration](#pool-configuration)
- [Contract Addresses](#contract-addresses)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Overview

GrimSwap enables privacy-preserving token swaps on Uniswap v4. The flow is:

1. **Deposit** — User deposits ETH to GrimPool with a cryptographic commitment
2. **Prove** — User generates a ZK proof (in browser) proving they deposited without revealing which deposit
3. **Swap** — Relayer submits the proof on-chain, executing the swap through Uniswap v4
4. **Receive** — Output tokens arrive at a stealth address, unlinkable to the depositor

The SDK handles steps 2-4 in a single function call.

---

## Prerequisites

- **Node.js** >= 18
- **npm** or **yarn**
- A web3 wallet connection (viem, ethers, or wagmi) for the deposit step
- Users need ETH on Unichain Sepolia (testnet)

---

## Installation

```bash
npm install @grimswap/circuits
```

The package includes:
- TypeScript SDK with full type definitions
- Circuit files (WASM + proving key) for browser proof generation
- All contract ABIs and addresses
- Relayer client

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Your Application                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              @grimswap/circuits SDK                      │     │
│  │                                                         │     │
│  │  createDepositNote()    — Create deposit commitment     │     │
│  │  executePrivateSwap()   — Full private swap (1 call)    │     │
│  │  fetchDeposits()        — Read on-chain deposits        │     │
│  │  submitToRelayer()      — Submit proof to relayer       │     │
│  │  generateProofFromBuffers() — ZK proof in browser       │     │
│  └─────────────────────────────────────────────────────────┘     │
│                          │                                       │
│              ┌───────────┼───────────┐                           │
│              ▼           ▼           ▼                           │
│         GrimPool     Relayer    Uniswap v4                      │
│        (deposit)   (submit tx)   (swap)                         │
│                          │                                       │
│                          ▼                                       │
│                   Stealth Address                                │
│                  (receive tokens)                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Integration Steps

### Step 1: Setup Circuit Files

The SDK needs two circuit files for proof generation in the browser. Copy them to your public directory:

```bash
npx grimswap-copy-circuits public/circuits
```

This copies:
- `privateSwap.wasm` (~2.4 MB) — witness generator
- `privateSwap.zkey` (~5.2 MB) — proving key

Load them in your app:

```typescript
async function loadCircuitFiles() {
  const [wasmResp, zkeyResp] = await Promise.all([
    fetch("/circuits/privateSwap.wasm"),
    fetch("/circuits/privateSwap.zkey"),
  ]);
  return {
    wasm: await wasmResp.arrayBuffer(),
    zkey: await zkeyResp.arrayBuffer(),
  };
}
```

**Tip:** Cache these in memory after first load — they don't change between sessions.

---

### Step 2: Deposit ETH

Users deposit ETH to GrimPool with a cryptographic commitment. This is the only on-chain action the user performs.

```typescript
import {
  createDepositNote,
  formatCommitmentForContract,
  serializeNote,
  GRIM_POOL_ABI,
  UNICHAIN_SEPOLIA_ADDRESSES,
} from "@grimswap/circuits";
import { parseEther } from "viem";

// 1. Create deposit note (generates random secret + nullifier)
const depositAmount = parseEther("1");
const note = await createDepositNote(depositAmount);

// 2. Format commitment as bytes32
const commitment = formatCommitmentForContract(note.commitment);

// 3. Send deposit transaction
const txHash = await walletClient.writeContract({
  address: UNICHAIN_SEPOLIA_ADDRESSES.grimPool,
  abi: GRIM_POOL_ABI,
  functionName: "deposit",
  args: [commitment],
  value: depositAmount,
});

// 4. Wait for confirmation and get leafIndex from event
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
const depositLog = receipt.logs.find(/* parse Deposit event */);
note.leafIndex = Number(depositLog.args.leafIndex);

// 5. CRITICAL: Save the note — user needs this to withdraw/swap
const serializedNote = serializeNote(note);
// Store securely (localStorage, encrypted storage, etc.)
localStorage.setItem("grimswap_deposit", serializedNote);
```

**Important:**
- The `note` contains the secret + nullifier. If lost, the deposit cannot be recovered.
- The `leafIndex` must be saved — it's needed for Merkle proof generation.
- Each deposit can only be used once (nullifier prevents double-spend).

---

### Step 3: Execute Private Swap

After depositing, the user can swap privately at any time. This can be in a different browser session.

```typescript
import {
  deserializeNote,
  executePrivateSwap,
  UNICHAIN_SEPOLIA_ADDRESSES,
} from "@grimswap/circuits";

// 1. Load saved note
const serialized = localStorage.getItem("grimswap_deposit");
const note = await deserializeNote(serialized);
note.leafIndex = savedLeafIndex; // restore from storage

// 2. Load circuit files
const { wasm, zkey } = await loadCircuitFiles();

// 3. Execute private swap (handles everything internally)
const result = await executePrivateSwap({
  note,
  recipient: recipientAddress,  // stealth address or any address
  poolKey: {
    currency0: "0x0000000000000000000000000000000000000000", // ETH
    currency1: "0xOutputTokenAddress",                       // token to receive
    fee: 3000,
    tickSpacing: 60,
    hooks: UNICHAIN_SEPOLIA_ADDRESSES.grimSwapZK,
  },
  zeroForOne: true,              // ETH → Token
  amountSpecified: -note.amount, // negative = exact input
  wasmBuffer: wasm,
  zkeyBuffer: zkey,
});

// 4. Check result
if (result.success) {
  console.log("Private swap executed!");
  console.log("TX Hash:", result.txHash);
  console.log("Block:", result.blockNumber);
  console.log("Gas Used:", result.gasUsed);

  // Clear the note — it's been used
  localStorage.removeItem("grimswap_deposit");
} else {
  console.error("Swap failed:", result.error);
}
```

**What `executePrivateSwap` does internally:**
1. Fetches all deposit commitments from GrimPool via JSON-RPC
2. Builds a Poseidon Merkle tree from the commitments
3. Gets relayer info (address + fee)
4. Generates a Groth16 ZK proof in the browser (~1-3 seconds)
5. Formats the proof for the smart contract
6. Submits to the relayer, which executes the on-chain transaction
7. Returns the transaction result

---

### Step 4: Verify Completion

```typescript
import { GRIM_POOL_ABI, UNICHAIN_SEPOLIA_ADDRESSES } from "@grimswap/circuits";

// Check nullifier is spent (deposit can't be reused)
const nullifierHex = "0x" + note.nullifierHash.toString(16).padStart(64, "0");
const isSpent = await publicClient.readContract({
  address: UNICHAIN_SEPOLIA_ADDRESSES.grimPool,
  abi: GRIM_POOL_ABI,
  functionName: "isSpent",
  args: [nullifierHex],
});

console.log("Nullifier spent:", isSpent); // true = swap completed
```

---

## Minimal Integration (One-Call)

Here's the absolute minimum code for a complete deposit + private swap:

```typescript
import {
  createDepositNote,
  formatCommitmentForContract,
  serializeNote,
  executePrivateSwap,
  GRIM_POOL_ABI,
  UNICHAIN_SEPOLIA_ADDRESSES,
} from "@grimswap/circuits";

// === DEPOSIT ===
const note = await createDepositNote(parseEther("1"));
await walletClient.writeContract({
  address: UNICHAIN_SEPOLIA_ADDRESSES.grimPool,
  abi: GRIM_POOL_ABI,
  functionName: "deposit",
  args: [formatCommitmentForContract(note.commitment)],
  value: parseEther("1"),
});
note.leafIndex = /* from Deposit event */;

// === PRIVATE SWAP ===
const wasm = await fetch("/circuits/privateSwap.wasm").then(r => r.arrayBuffer());
const zkey = await fetch("/circuits/privateSwap.zkey").then(r => r.arrayBuffer());

const result = await executePrivateSwap({
  note,
  recipient: stealthAddress,
  poolKey: {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: tokenAddress,
    fee: 3000,
    tickSpacing: 60,
    hooks: UNICHAIN_SEPOLIA_ADDRESSES.grimSwapZK,
  },
  zeroForOne: true,
  amountSpecified: -note.amount,
  wasmBuffer: wasm,
  zkeyBuffer: zkey,
});
// result.txHash — done!
```

---

## Advanced Usage

### Manual Proof Generation

For more control over the proof generation process:

```typescript
import {
  fetchDeposits,
  buildMerkleTree,
  generateProofFromBuffers,
  formatProofForContract,
  submitToRelayer,
  getRelayerInfo,
} from "@grimswap/circuits";

// 1. Fetch deposits and build tree
const commitments = await fetchDeposits();
const tree = await buildMerkleTree(commitments);
const merkleProof = tree.getProof(note.leafIndex);

// 2. Get relayer info
const relayer = await getRelayerInfo();

// 3. Generate proof
const { proof, publicSignals } = await generateProofFromBuffers(
  note,
  merkleProof,
  {
    recipient: BigInt(recipientAddress).toString(),
    relayer: relayer.address,
    relayerFee: relayer.fee,
    expectedAmountOut: note.amount,
  },
  wasmBuffer,
  zkeyBuffer
);

// 4. Format and submit
const formatted = formatProofForContract(proof, publicSignals);
const result = await submitToRelayer(
  undefined, // uses default relayer
  { a: formatted.pA, b: formatted.pB, c: formatted.pC },
  formatted.pubSignals,
  {
    poolKey: { /* ... */ },
    zeroForOne: true,
    amountSpecified: (-note.amount).toString(),
    sqrtPriceLimitX96: "4295128740",
  }
);
```

### Stealth Addresses

Generate unlinkable recipient addresses for maximum privacy:

```typescript
import {
  generateStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
} from "@grimswap/circuits";

// Receiver: generate keys once, share meta-address
const keys = generateStealthKeys();
// Share keys.stealthMetaAddress with senders

// Sender: generate one-time stealth address
const stealth = generateStealthAddress(receiverMetaAddress);
// Use stealth.stealthAddress as recipient in executePrivateSwap()

// Receiver: scan for incoming payments
const payments = await scanAnnouncements({
  publicClient,
  viewingPrivateKey: keys.viewingPrivateKey,
  spendingPublicKey: keys.spendingPublicKey,
});
```

### Custom Relayer

Point to a different relayer instance:

```typescript
import { checkRelayerHealth, getRelayerInfo } from "@grimswap/circuits";

const customRelayer = "https://my-relayer.example.com";

// Check health
const isUp = await checkRelayerHealth(customRelayer);

// Get info
const { address, fee } = await getRelayerInfo(customRelayer);

// Use in executePrivateSwap
const result = await executePrivateSwap({
  // ...
  relayerUrl: customRelayer,
});
```

### Reading Deposits

Query on-chain deposit data:

```typescript
import { fetchDeposits, fetchDepositEvents, getDepositCount } from "@grimswap/circuits";

// Get ordered commitment array (for tree building)
const commitments = await fetchDeposits();

// Get full deposit events with metadata
const events = await fetchDepositEvents();
for (const event of events) {
  console.log(`Deposit #${event.leafIndex}: ${event.commitment}`);
  console.log(`  Block: ${event.blockNumber}, TX: ${event.transactionHash}`);
}

// Quick count
const count = await getDepositCount();
console.log(`Total deposits: ${count}`);
```

---

## Pool Configuration

### Pool Key

Every swap targets a specific Uniswap v4 pool:

```typescript
import type { PoolKey } from "@grimswap/circuits";

const poolKey: PoolKey = {
  currency0: "0x0000000000000000000000000000000000000000", // ETH (always lower address)
  currency1: "0xTokenAddress",                             // Output token
  fee: 3000,                                               // Fee tier
  tickSpacing: 60,                                         // Must match fee
  hooks: UNICHAIN_SEPOLIA_ADDRESSES.grimSwapZK,            // Always use GrimSwap hook
};
```

### Fee Tiers

| Fee | Tick Spacing | Use Case |
|-----|-------------|----------|
| 500 | 10 | Stable pairs (USDC/USDT) |
| 3000 | 60 | Standard pairs (ETH/USDC) |
| 10000 | 200 | Exotic pairs |

### Swap Direction

| Parameter | `zeroForOne: true` | `zeroForOne: false` |
|-----------|-------------------|---------------------|
| Direction | currency0 → currency1 | currency1 → currency0 |
| Example | ETH → USDC | USDC → ETH |
| sqrtPriceLimitX96 | `4295128740` (MIN+1) | `1461446703485210103287273052203988822378723970341` (MAX-1) |
| amountSpecified | Negative = exact input | Negative = exact input |

### sqrtPriceX96 Reference (ETH/USDC)

For ETH = currency0, USDC (6 decimals) = currency1:

| ETH Price | sqrtPriceX96 |
|-----------|-------------|
| $2,000 | `3543191142285914205922034` |
| $3,000 | `4339505028714986015908034` |

Formula: `sqrt(price_usdc * 10^6 / 10^18) * 2^96`

---

## Contract Addresses

### Unichain Sepolia (Chain ID: 1301)

| Contract | Address | Description |
|----------|---------|-------------|
| **GrimPool** | `0xEAB5E7B4e715A22E8c114B7476eeC15770B582bb` | Deposit pool with Merkle tree |
| **GrimSwapZK** | `0xeB72E2495640a4B83EBfc4618FD91cc9beB640c4` | Uniswap v4 hook (ZK verification) |
| **GrimSwapRouter** | `0xC13a6a504da21aD23c748f08d3E991621D42DA4F` | Swap executor |
| **Groth16Verifier** | `0xF7D14b744935cE34a210D7513471a8E6d6e696a0` | On-chain proof verifier |
| **PoolManager** | `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` | Uniswap v4 pool manager |

All addresses are available programmatically:

```typescript
import { UNICHAIN_SEPOLIA_ADDRESSES } from "@grimswap/circuits";
```

### Relayer

| Environment | URL |
|-------------|-----|
| Production | `https://services.grimswap.com` |
| Local Dev | `http://localhost:3001` |

Default URL is production — no configuration needed.

---

## API Reference

### Core Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `createDepositNote(amount)` | Create deposit with random secret + nullifier | `Promise<DepositNote>` |
| `formatCommitmentForContract(commitment)` | Format commitment as bytes32 | `string` |
| `executePrivateSwap(params)` | Complete private swap in one call | `Promise<RelayerResponse>` |
| `serializeNote(note)` | Serialize note to string for storage | `string` |
| `deserializeNote(str)` | Restore note from serialized string | `Promise<DepositNote>` |

### Deposit Reading

| Function | Description | Returns |
|----------|-------------|---------|
| `fetchDeposits(rpcUrl?)` | Get ordered commitment array | `Promise<bigint[]>` |
| `fetchDepositEvents(rpcUrl?)` | Get deposits with full metadata | `Promise<DepositEvent[]>` |
| `getDepositCount(rpcUrl?)` | Get total deposit count | `Promise<number>` |

### Proof Generation

| Function | Description | Returns |
|----------|-------------|---------|
| `generateProofFromBuffers(note, proof, params, wasm, zkey)` | Browser-compatible proof generation | `Promise<{proof, publicSignals}>` |
| `formatProofForContract(proof, signals)` | Format for Solidity | `ContractProof` |

### Relayer

| Function | Description | Returns |
|----------|-------------|---------|
| `submitToRelayer(url, proof, signals, params)` | Submit proof for execution | `Promise<RelayerResponse>` |
| `getRelayerInfo(url?)` | Get relayer address + fee | `Promise<{address, fee}>` |
| `checkRelayerHealth(url?)` | Check relayer is online | `Promise<boolean>` |

### Merkle Tree

| Function | Description | Returns |
|----------|-------------|---------|
| `buildMerkleTree(commitments)` | Build Poseidon Merkle tree | `Promise<MerkleTree>` |
| `MerkleTree.getProof(leafIndex)` | Generate inclusion proof | `MerkleProof` |

### Stealth Addresses

| Function | Description | Returns |
|----------|-------------|---------|
| `generateStealthKeys()` | Generate spending + viewing keys | `StealthKeys` |
| `generateStealthAddress(metaAddress)` | Derive one-time address | `GeneratedStealthAddress` |
| `scanAnnouncements(params)` | Scan for incoming payments | `Promise<StealthPayment[]>` |

---

## Troubleshooting

### "WASM file not found"

Circuit files aren't in your public directory. Run:
```bash
npx grimswap-copy-circuits public/circuits
```

### "note.leafIndex is required"

You need to set `note.leafIndex` after the deposit transaction confirms. Get it from the `Deposit` event:
```typescript
// Parse the Deposit event from transaction receipt
note.leafIndex = Number(depositEvent.args.leafIndex);
```

### "Relayer returned 400"

Common causes:
- Nullifier already spent (deposit already used)
- Invalid Merkle root (root not known to GrimPool)
- Proof verification failed (corrupted circuit files)

### "RPC error" from fetchDeposits

The default RPC is Unichain Sepolia public endpoint. If rate-limited, provide your own:
```typescript
const commitments = await fetchDeposits("https://your-rpc-endpoint.com");
```

### Proof generation is slow

First proof takes ~3-5 seconds (WASM initialization). Subsequent proofs are ~1-2 seconds. Cache the loaded WASM/zkey buffers between calls.

### Browser bundle size

The circuit files (WASM + zkey) are ~7.6MB total. They're loaded at runtime via `fetch()`, not bundled — so they don't affect your initial bundle size.

### Testnet: "Root not known"

On testnet, you need to register the Merkle root after building the tree:
```typescript
await grimPool.write.addKnownRoot([rootHex]);
```
This step is not needed on mainnet.

---

## Support

- SDK Issues: [github.com/grimswap/grimswap-circuits/issues](https://github.com/grimswap/grimswap-circuits/issues)
- Relayer Issues: [github.com/grimswap/grimswap-relayer/issues](https://github.com/grimswap/grimswap-relayer/issues)
- Contract Issues: [github.com/grimswap/grimswap-contracts/issues](https://github.com/grimswap/grimswap-contracts/issues)
