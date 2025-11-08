# solana-tx-to-ts-dataset

Turn **real on-chain transactions** into **near-equivalent TypeScript client code**.
This repo is tailored for the six target programs:

- System Program: `11111111111111111111111111111111`
- Token Program (SPL): `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Token-2022 Program: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (compat)
- Associated Token Program: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
- Memo Program: `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`
- Compute Budget: `ComputeBudget111111111111111111111111111111`

## What it does

1. Take a list of transaction signatures from Solana RPC in `data/signatures.csv`.
2. Fetch each transaction from **public RPC**.
3. Prefer parsed form; map known programs into high-level `@solana/web3.js` / `@solana/spl-token` calls.
4. Fallback to a raw `TransactionInstruction` if it can’t be parsed.
5. Emit one TypeScript file per tx to `out_ts/` (each exporting `executeSkill(blockhash)`).
6. Emit a JSONL manifest of outputs via `npm run generate:manifest`.

## Quickstart

### 1. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env file and configure:
# - SOLANA_RPC_URL: Your Solana RPC endpoint(s)
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Fetch Swap Transaction Signatures

Fetch swap transactions directly from Solana RPC node:

```bash
# Fetch signatures from all DEX programs
# Default: 1000 signatures per program
node src/fetch_swap_transactions.js

# Specify custom limit per program
node src/fetch_swap_transactions.js 500

# The script will:
# - Query all major DEX programs (Raydium, Orca, Jupiter, etc.)
# - Fetch recent transaction signatures
# - Merge and deduplicate with existing data
# - Save to data/signatures.csv
```

### 4. Extract and Decompile Transactions

```bash
# Process transactions from signatures.csv
node src/extract_and_decompile_public_rpc.js data/signatures.csv

# Or start from a specific signature
node src/extract_and_decompile_public_rpc.js data/signatures.csv <start_signature>
```

### 5. Generate Manifest

```bash
npm run generate:manifest
```

## Outputs

- `out_ts/*.ts` — Reconstructed TypeScript code
- `out_jsonl/*.json` — Per-signature cached raw/parsed RPC response
- `manifest.jsonl` — Summary manifest

## File Descriptions

### Core Scripts

- **`src/fetch_swap_transactions.js`** - Fetch swap transaction signatures from Solana RPC
  - Queries all major DEX programs directly from RPC
  - Supports configurable limit per program
  - Automatic deduplication
  - No external API dependencies

- **`src/extract_and_decompile_public_rpc.js`** - Extract and decompile transactions
  - Supports multiple RPC nodes for load balancing
  - 0.3 second delay between requests to same RPC to avoid rate limits
  - Resume processing from specific signature
  - Automatic retry on failed requests

- **`src/generate_manifest.js`** - Generate manifest file
  - Creates JSONL manifest of all processed transactions

### Configuration Files

- **`.env.example`** - Environment variable template with RPC configuration

## Workflow

```
Solana RPC Node
    ↓
fetch_swap_transactions.js (query DEX programs)
    ↓
data/signatures.csv (signature list)
    ↓
extract_and_decompile_public_rpc.js (extract & decompile)
    ↓
out_ts/*.ts (TypeScript code)
    ↓
generate:manifest (generate manifest)
    ↓
manifest.jsonl (final output)
```

## RPC Configuration

Configure your Solana RPC endpoint(s) via the `SOLANA_RPC_URL` environment variable:

```bash
# Single RPC endpoint
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Multiple RPC endpoints for load balancing (comma-separated)
SOLANA_RPC_URL=https://rpc1.example.com,https://rpc2.example.com,https://rpc3.example.com
```

The script uses round-robin strategy to distribute requests across multiple RPCs with 0.3 second delay between requests to the same endpoint.

## Supported DEX Programs

The RPC fetcher queries the following DEX programs:

- **Raydium AMM** - `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- **Raydium CLMM** - `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`
- **Orca Whirlpool** - `9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP`
- **Orca V1** - `DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1`
- **Jupiter V6** - `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`
- **Jupiter V4** - `JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB`
- **Phoenix** - `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`
- **Meteora DLMM** - `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB`
- **Meteora Pools** - `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`

## Placeholders inside generated TS

- `AGENT_PUBKEY_BASE58`
- `RENT_EXEMPT_LAMPORTS` / `RENT_EXEMPT_LAMPORTS_165`
- `MINT_BASE58`, `MINT_DECIMALS`

Generated: 2025-10-20T00:51:03.379233Z
