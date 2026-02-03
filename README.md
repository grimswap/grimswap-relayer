# GrimSwap Relayer

HTTP service that accepts ZK proofs and submits private swap transactions to the blockchain, hiding user identity by paying gas on their behalf.

## Why a Relayer?

Without a relayer, even with valid ZK proofs, the user's identity is leaked through the gas payment:

```
❌ Without Relayer:
User submits tx → User pays gas → tx.origin = User's address → Privacy broken!

✅ With Relayer:
User sends proof to Relayer → Relayer submits tx → tx.origin = Relayer → Privacy preserved!
```

## API Endpoints

### POST /relay

Submit a private swap transaction.

```json
{
  "proof": {
    "a": ["0x...", "0x..."],
    "b": [["0x...", "0x..."], ["0x...", "0x..."]],
    "c": ["0x...", "0x..."]
  },
  "publicSignals": [
    "merkleRoot",
    "nullifierHash",
    "recipient",
    "relayer",
    "relayerFee",
    "swapAmountOut"
  ],
  "swapParams": {
    "poolKey": {
      "currency0": "0x...",
      "currency1": "0x...",
      "fee": 3000,
      "tickSpacing": 60,
      "hooks": "0x..."
    },
    "zeroForOne": true,
    "amountSpecified": "1000000000000000000",
    "sqrtPriceLimitX96": "0"
  }
}
```

Response:
```json
{
  "success": true,
  "txHash": "0x...",
  "blockNumber": 12345,
  "gasUsed": "250000",
  "relayerFee": "1000000000000000"
}
```

### GET /status/:txHash

Check transaction status.

```json
{
  "status": "confirmed",
  "blockNumber": "12345",
  "gasUsed": "250000"
}
```

### GET /fee

Get current fee information.

```json
{
  "relayerFeeBps": 10,
  "relayerFeePercent": 0.1,
  "gasPrice": "1000000",
  "estimatedGas": "250000"
}
```

### GET /fee/quote?amount=1000000000000000000

Get fee quote for specific amount.

```json
{
  "inputAmount": "1000000000000000000",
  "relayerFee": "1000000000000000",
  "netAmount": "999000000000000000"
}
```

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `RELAYER_PRIVATE_KEY` - Private key for relayer wallet (must have ETH for gas)
- `RPC_URL` - RPC endpoint for Unichain

## Running

Development:
```bash
npm run dev
```

Production:
```bash
npm run build
npm start
```

## Security

- Rate limiting: 10 requests/minute per IP
- Request validation: All inputs are validated
- Helmet: Security headers enabled
- CORS: Configurable allowed origins

## Gas Requirements

The relayer wallet needs ETH to pay for gas. Monitor the balance:

```bash
curl http://localhost:3001/status/relayer/info
```

## Docker

```bash
docker build -t grimswap-relayer .
docker run -p 3001:3001 --env-file .env grimswap-relayer
```

## License

MIT
