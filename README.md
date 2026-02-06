# GrimSwap Relayer

Gas relayer service for GrimSwap private swaps. Submits transactions on behalf of users so their wallet address never appears on-chain.

## How It Works

1. User generates ZK proof client-side
2. User sends proof + swap params to relayer API
3. Relayer validates proof, calls `GrimSwapRouter.executePrivateSwap()`
4. Router atomically: releases ETH from GrimPool -> swaps on Uniswap v4
5. GrimSwapZK hook verifies proof and routes output to stealth address
6. Relayer optionally funds stealth address with ETH for gas

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

**Request body:**
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
      "fee": 3000,
      "tickSpacing": 60,
      "hooks": "0x3bee7D1A5914d1ccD34D2a2d00C359D0746400C4"
    },
    "zeroForOne": true,
    "amountSpecified": "-1000000000000000",
    "sqrtPriceLimitX96": "4295128740"
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

## Contract Addresses (Unichain Sepolia)

| Contract | Address |
|----------|---------|
| GrimPool | `0xEAB5E7B4e715A22E8c114B7476eeC15770B582bb` |
| GrimSwapZK (Hook) | `0x3bee7D1A5914d1ccD34D2a2d00C359D0746400C4` |
| GrimSwapRouter | `0xC13a6a504da21aD23c748f08d3E991621D42DA4F` |
| Groth16Verifier | `0xF7D14b744935cE34a210D7513471a8E6d6e696a0` |
| PoolSwapTest | `0x9140a78c1A137c7fF1c151EC8231272aF78a99A4` |
| PoolManager | `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` |
| USDC | `0x31d0220469e10c4E71834a79b1f276d740d3768F` |

## Pool Configuration

The ETH/USDC GrimSwap Privacy Pool uses:
- **Fee**: 3000 (0.3%)
- **TickSpacing**: 60
- **Pool ID**: `0xca4150cd3ab144877e0dee5630129d84b986daa7ef5f287729e2f2da00c3fe38`

## Features

- Auto-adds Merkle root if relayer is GrimPool owner (testnet)
- Funds stealth addresses with ETH for token claiming
- Rate limiting per IP
- Request validation
- Detailed error responses

## License

MIT
