# GrimSwap Relayer

Gas relayer service for GrimSwap private swaps. Submits transactions on behalf of users so their wallet address never appears on-chain.

## V3 Multi-Token Support

The relayer now supports both ETH and ERC20 token deposits through GrimPoolMultiToken:

- **ETH deposits**: Calls `executePrivateSwap()` on GrimSwapRouterV2
- **ERC20 deposits**: Calls `executePrivateSwapToken()` with `inputToken` parameter

## How It Works

1. User deposits ETH or ERC20 to GrimPoolMultiToken
2. User generates ZK proof client-side
3. User sends proof + swap params to relayer API
4. Relayer validates proof, calls GrimSwapRouterV2
5. Router atomically: releases funds from pool -> swaps on Uniswap v4
6. GrimSwapZK hook verifies proof and routes output to stealth address
7. Relayer optionally funds stealth address with ETH for gas

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your relayer private key
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RELAYER_PRIVATE_KEY` | Relayer wallet private key (required) | - |
| `RPC_URL` | Unichain RPC endpoint | `https://sepolia.unichain.org` |
| `PORT` | Server port | `3001` |
| `RELAYER_FEE_BPS` | Fee in basis points | `10` (0.1%) |
| `ENABLE_STEALTH_FUNDING` | Fund stealth addresses with ETH | `true` |
| `STEALTH_FUNDING_WEI` | ETH to send to stealth addresses | `500000000000000` (0.0005 ETH) |

## Running

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### `GET /health`
Health check.

### `GET /info`
Returns relayer address and configuration.

### `POST /relay`
Submit a private swap.

**Request body (ETH swap):**
```json
{
  "proof": {
    "a": ["<uint256>", "<uint256>"],
    "b": [["<uint256>", "<uint256>"], ["<uint256>", "<uint256>"]],
    "c": ["<uint256>", "<uint256>"]
  },
  "publicSignals": ["<signal0>", ..., "<signal7>"],
  "swapParams": {
    "poolKey": {
      "currency0": "0x0000000000000000000000000000000000000000",
      "currency1": "0x31d0220469e10c4E71834a79b1f276d740d3768F",
      "fee": 500,
      "tickSpacing": 10,
      "hooks": "0x6AFe3f3B81d6a22948800C924b2e9031e76E00C4"
    },
    "zeroForOne": true,
    "amountSpecified": "-1000000000000000",
    "sqrtPriceLimitX96": "4295128740"
  }
}
```

**Request body (ERC20 swap - add inputToken):**
```json
{
  "proof": { ... },
  "publicSignals": [...],
  "swapParams": {
    "poolKey": { ... },
    "zeroForOne": false,
    "amountSpecified": "-1000000",
    "sqrtPriceLimitX96": "1461446703485210103287273052203988822378723970341",
    "inputToken": "0x31d0220469e10c4E71834a79b1f276d740d3768F"
  }
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "blockNumber": 12345,
  "gasUsed": 499760
}
```

### Public Signals Order

| Index | Signal | Description |
|-------|--------|-------------|
| 0 | computedCommitment | Circuit output |
| 1 | computedNullifierHash | Circuit output |
| 2 | merkleRoot | Poseidon Merkle tree root |
| 3 | nullifierHash | Prevents double-spend |
| 4 | recipient | Stealth address |
| 5 | relayer | Relayer address |
| 6 | relayerFee | Fee in basis points |
| 7 | swapAmountOut | Deposit amount |

## Contract Addresses (Unichain Sepolia) - V3

| Contract | Address |
|----------|---------|
| GrimPoolMultiToken | `0x6777cfe2A72669dA5a8087181e42CA3dB29e7710` |
| GrimSwapZK (Hook) | `0x6AFe3f3B81d6a22948800C924b2e9031e76E00C4` |
| GrimSwapRouterV2 | `0x5EE78E89A0d5B4669b05aC8B7D7ea054a08f555f` |
| Groth16Verifier | `0xF7D14b744935cE34a210D7513471a8E6d6e696a0` |
| PoolSwapTest | `0x9140a78c1A137c7fF1c151EC8231272aF78a99A4` |
| PoolManager | `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` |
| USDC | `0x31d0220469e10c4E71834a79b1f276d740d3768F` |

## Pool Configuration (V3)

The ETH/USDC GrimSwap Privacy Pool uses:
- **Fee**: 500 (0.05%)
- **TickSpacing**: 10
- **Hook**: `0x6AFe3f3B81d6a22948800C924b2e9031e76E00C4`

## Swap Directions

| Direction | zeroForOne | sqrtPriceLimitX96 |
|-----------|------------|-------------------|
| ETH → USDC | `true` | `4295128740` (MIN) |
| USDC → ETH | `false` | `1461446703485210103287273052203988822378723970341` (MAX-1) |

## Features

- Multi-token support (ETH + ERC20)
- Auto-selects correct router function based on inputToken
- Auto-adds Merkle root if relayer is pool owner (testnet)
- Funds stealth addresses with ETH for token claiming
- Rate limiting per IP
- Request validation
- Detailed error responses

## License

MIT
