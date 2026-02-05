# Frontend Handover

Everything the frontend needs to integrate GrimSwap private swaps using the `@grimswap/circuits` SDK.

## Install

```bash
npm install @grimswap/circuits
npx grimswap-copy-circuits public/circuits
```

## Fastest Integration (executePrivateSwap)

```typescript
import {
  createDepositNote,
  formatCommitmentForContract,
  serializeNote,
  executePrivateSwap,
  GRIM_POOL_ABI,
  UNICHAIN_SEPOLIA_ADDRESSES,
} from "@grimswap/circuits";

// --- DEPOSIT PHASE ---
const note = await createDepositNote(parseEther("1"));
const commitment = formatCommitmentForContract(note.commitment);

// Deposit on-chain
const tx = await walletClient.writeContract({
  address: UNICHAIN_SEPOLIA_ADDRESSES.grimPool,
  abi: GRIM_POOL_ABI,
  functionName: "deposit",
  args: [commitment],
  value: parseEther("1"),
});

// Save leafIndex from Deposit event + save note
note.leafIndex = depositEvent.args.leafIndex;
localStorage.setItem("grimswap_note", serializeNote(note));

// --- SWAP PHASE (can be later, different session) ---
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

console.log("TX:", result.txHash);
```

`executePrivateSwap` handles everything internally: fetches deposits, builds Merkle tree, generates ZK proof, contacts relayer, submits transaction.

## Contract Addresses (Unichain Sepolia, Chain ID: 1301)

```typescript
import { UNICHAIN_SEPOLIA_ADDRESSES } from "@grimswap/circuits";

// UNICHAIN_SEPOLIA_ADDRESSES.grimPool        → 0xEAB5E7B4e715A22E8c114B7476eeC15770B582bb
// UNICHAIN_SEPOLIA_ADDRESSES.grimSwapZK      → 0xeB72E2495640a4B83EBfc4618FD91cc9beB640c4
// UNICHAIN_SEPOLIA_ADDRESSES.grimSwapRouter   → 0xC13a6a504da21aD23c748f08d3E991621D42DA4F
// UNICHAIN_SEPOLIA_ADDRESSES.groth16Verifier  → 0xF7D14b744935cE34a210D7513471a8E6d6e696a0
// UNICHAIN_SEPOLIA_ADDRESSES.poolManager      → 0x00B036B58a818B1BC34d502D3fE730Db729e62AC
```

## Relayer

- Production: `https://services.grimswap.com` (default, no config needed)
- Dev: `http://localhost:3001`
- Endpoints: `GET /health`, `GET /info`, `POST /relay`

## Step-by-Step Flow (Manual Control)

If you need more control than `executePrivateSwap`, here's each step separately.

### 1. Deposit ETH to GrimPool

```typescript
import {
  createDepositNote,
  formatCommitmentForContract,
  GRIM_POOL_ABI,
  UNICHAIN_SEPOLIA_ADDRESSES,
} from "@grimswap/circuits";
import { parseEther } from "viem";

// Create deposit note (stores secret + nullifier locally)
const note = await createDepositNote(parseEther("1"));

// Format commitment for on-chain deposit
const commitment = formatCommitmentForContract(note.commitment);

// Submit to GrimPool contract
await grimPool.write.deposit([commitment], { value: parseEther("1") });

// IMPORTANT: Save the note securely — user needs it to withdraw
const serialized = serializeNote(note);
localStorage.setItem("grimswap_note", serialized);
```

### 2. Build Poseidon Merkle Tree (Client-Side)

```typescript
import { fetchDeposits, buildMerkleTree } from "@grimswap/circuits";

// Fetch all deposits from GrimPool (uses JSON-RPC, no viem/ethers needed)
const commitments = await fetchDeposits();

// Build tree and get proof for our deposit
const tree = await buildMerkleTree(commitments);
const merkleProof = tree.getProof(note.leafIndex);
```

### 3. Add Merkle Root (Testnet Only)

```typescript
// On testnet, the depositor adds their own root
const rootBytes = "0x" + merkleProof.root.toString(16).padStart(64, "0");
await grimPool.write.addKnownRoot([rootBytes]);
```

### 4. Generate Stealth Address

```typescript
import { generateStealthKeys, generateStealthAddress } from "@grimswap/circuits";

// Generate stealth keys (or load existing ones)
const keys = generateStealthKeys();

// Generate one-time stealth address for this swap
const stealth = generateStealthAddress(keys.stealthMetaAddress);
// stealth.stealthAddress — unlinkable to user
```

### 5. Generate ZK Proof (Browser)

```typescript
import { generateProofFromBuffers, formatProofForContract } from "@grimswap/circuits";

// Fetch circuit files (host these on your CDN or use the npm package paths)
const wasmResp = await fetch("/circuits/privateSwap.wasm");
const zkeyResp = await fetch("/circuits/privateSwap.zkey");
const wasmBuffer = await wasmResp.arrayBuffer();
const zkeyBuffer = await zkeyResp.arrayBuffer();

// Generate ZK proof in browser
const { proof, publicSignals } = await generateProofFromBuffers(
  note,
  merkleProof,
  {
    recipient: BigInt(stealth.stealthAddress).toString(),
    relayer: relayerAddress,
    relayerFee: 10, // basis points (0.1%)
    expectedAmountOut: note.amount,
  },
  wasmBuffer,
  zkeyBuffer
);

// Format for contract/relayer
const formatted = formatProofForContract(proof, publicSignals);
```

### 6. Send to Relayer

```typescript
import { submitToRelayer, UNICHAIN_SEPOLIA_ADDRESSES } from "@grimswap/circuits";

const result = await submitToRelayer(
  undefined, // uses RELAYER_DEFAULT_URL (https://services.grimswap.com)
  {
    a: formatted.pA,
    b: formatted.pB,
    c: formatted.pC,
  },
  formatted.pubSignals,
  {
    poolKey: {
      currency0: "0x0000000000000000000000000000000000000000", // ETH
      currency1: "<output_token_address>",
      fee: 3000,
      tickSpacing: 60,
      hooks: UNICHAIN_SEPOLIA_ADDRESSES.grimSwapZK,
    },
    zeroForOne: true,
    amountSpecified: (-note.amount).toString(), // negative = exact input
    sqrtPriceLimitX96: "4295128740", // MIN_SQRT_PRICE + 1 for zeroForOne
  }
);

if (result.success) {
  console.log("TX:", result.txHash);
  console.log("Block:", result.blockNumber);
  console.log("Gas:", result.gasUsed);
}
```

### 7. Verify Receipt

```typescript
import { GRIM_POOL_ABI } from "@grimswap/circuits";

// Check nullifier was spent (prevents reuse)
const rootBytes = "0x" + note.nullifierHash.toString(16).padStart(64, "0");
const spent = await grimPool.read.isSpent([rootBytes]);

// Check output token balance at stealth address
const balance = await token.read.balanceOf([stealth.stealthAddress]);
```

## Relayer Utilities

```typescript
import { checkRelayerHealth, getRelayerInfo } from "@grimswap/circuits";

// Check if relayer is online
const healthy = await checkRelayerHealth(); // uses production relayer

// Get relayer address and fee
const info = await getRelayerInfo(); // uses production relayer
// info.address — relayer's ETH address
// info.fee — fee in basis points
```

## Creating a Pool

The GrimSwapZK hook supports **any** pool with its address as the hook.

### Pool Key Format

```typescript
import type { PoolKey } from "@grimswap/circuits";

const poolKey: PoolKey = {
  currency0: "0x0000000000000000000000000000000000000000", // ETH (must be lower address)
  currency1: tokenAddress,
  fee: 3000,
  tickSpacing: 60,
  hooks: UNICHAIN_SEPOLIA_ADDRESSES.grimSwapZK,
};
```

### Initialize Pool

```typescript
await poolManager.write.initialize([poolKey, sqrtPriceX96]);
```

### Fee/TickSpacing Reference

| Fee | TickSpacing | Use Case |
|-----|-------------|----------|
| 500 | 10 | Stable pairs |
| 3000 | 60 | Most pairs |
| 10000 | 200 | Exotic pairs |

### sqrtPriceX96 for ETH/USDC

For ETH = currency0, USDC = currency1 (6 decimals):
- $2000/ETH: `3543191142285914205922034`
- $3000/ETH: `4339505028714986015908034`

Formula: `sqrt(price_usdc * 10^6 / 10^18) * 2^96`

## Dual-Mode Hook

The GrimSwapZK hook supports both regular and private swaps on the same pool:

- **Regular swap**: Pass empty `hookData` (`0x`) — no ZK verification
- **Private swap**: Pass encoded ZK proof as `hookData` — full verification + stealth routing

## ABIs

All ABIs are exported from the SDK:

```typescript
import {
  GRIM_POOL_ABI,
  GRIM_SWAP_ZK_ABI,
  GRIM_SWAP_ROUTER_ABI,
  GROTH16_VERIFIER_ABI,
  STEALTH_REGISTRY_ABI,
  ANNOUNCER_ABI,
} from "@grimswap/circuits";
```

## Circuit Files for Browser

```bash
npx grimswap-copy-circuits public/circuits
```

This copies the WASM (~2.4MB) and zkey (~5.2MB) to your public folder. Then load them at runtime:

```typescript
const wasm = await fetch("/circuits/privateSwap.wasm").then(r => r.arrayBuffer());
const zkey = await fetch("/circuits/privateSwap.zkey").then(r => r.arrayBuffer());
```

## Production Test Reference

See `grimswap-test/src/fullZKSwapWithRelayer.ts` for a complete working implementation of the entire flow.

Successful test TX: [`0xca2fa2b5...`](https://unichain-sepolia.blockscout.com/tx/0xca2fa2b55af5a94f9d1ea3712aa08c847154a4327172172a4f1bfa861d0e4461)
