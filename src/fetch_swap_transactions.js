/**
 * src/fetch_swap_transactions.js
 * Fetch swap transactions directly from Solana RPC node
 * Monitors DEX program accounts for swap transactions
 */
import fs from 'fs';
import path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';

// Configuration
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DATA_DIR = 'data';
const OUTPUT_FILE = path.join(DATA_DIR, 'signatures.csv');

// DEX Program addresses
const DEX_PROGRAMS = {
  'RAYDIUM_AMM': '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'RAYDIUM_CLMM': 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'ORCA_WHIRLPOOL': '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
  'ORCA_V1': 'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',
  'JUPITER_V6': 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'JUPITER_V4': 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  'PHOENIX': 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',
  'METEORA_DLMM': 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
  'METEORA_POOLS': 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Fetch transaction signatures for a specific program
 * @param {Connection} connection - Solana RPC connection
 * @param {string} programAddress - DEX program address
 * @param {number} limit - Maximum number of signatures to fetch
 * @returns {Promise<Array>} Array of signature objects
 */
async function fetchProgramSignatures(connection, programAddress, limit = 1000) {
  try {
    const publicKey = new PublicKey(programAddress);

    console.log(`[info] Fetching signatures for program: ${programAddress}`);

    const signatures = await connection.getSignaturesForAddress(
      publicKey,
      { limit },
      'confirmed'
    );

    console.log(`[ok] Found ${signatures.length} signatures`);
    return signatures;

  } catch (error) {
    console.error(`[error] Failed to fetch signatures for ${programAddress}:`, error.message);
    return [];
  }
}

/**
 * Fetch swap transactions from all DEX programs
 * @param {number} limitPerProgram - Max signatures per program
 */
async function fetchSwapTransactions(limitPerProgram = 1000) {
  console.log('================================================');
  console.log('Fetching Swap Transactions from Solana RPC');
  console.log('================================================\n');

  console.log(`[info] RPC Endpoint: ${SOLANA_RPC_URL}`);
  console.log(`[info] Limit per program: ${limitPerProgram}\n`);

  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

  // Verify connection
  try {
    const version = await connection.getVersion();
    console.log(`[ok] Connected to Solana RPC (version: ${version['solana-core']})\n`);
  } catch (error) {
    console.error('[error] Failed to connect to Solana RPC:', error.message);
    process.exit(1);
  }

  const allSignatures = new Set(); // Use Set to deduplicate
  const signatureDetails = [];

  // Fetch signatures from each DEX program
  for (const [dexName, programAddress] of Object.entries(DEX_PROGRAMS)) {
    console.log(`\n[Step] Processing ${dexName}...`);

    const signatures = await fetchProgramSignatures(
      connection,
      programAddress,
      limitPerProgram
    );

    // Add signatures with metadata
    for (const sig of signatures) {
      if (!allSignatures.has(sig.signature)) {
        allSignatures.add(sig.signature);
        signatureDetails.push({
          signature: sig.signature,
          dex_program: programAddress,
          dex_name: dexName.replace(/_/g, ' '),
          block_time: sig.blockTime,
          slot: sig.slot
        });
      }
    }

    // Rate limiting - wait 1 second between programs
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n[info] Total unique signatures collected: ${allSignatures.size}`);

  // Save to CSV
  saveSignaturesToCSV(signatureDetails);

  console.log('\n================================================');
  console.log('[Completed] All signatures saved!');
  console.log('================================================\n');
  console.log(`Output file: ${OUTPUT_FILE}`);
  console.log(`Total signatures: ${allSignatures.size}\n`);
  console.log('Next steps:');
  console.log(`  node src/extract_and_decompile_public_rpc.js ${OUTPUT_FILE}`);
  console.log('');
}

/**
 * Save signatures to CSV file
 * @param {Array} signatures - Array of signature objects
 */
function saveSignaturesToCSV(signatures) {
  // Sort by block time (newest first)
  signatures.sort((a, b) => (b.block_time || 0) - (a.block_time || 0));

  // Check if file exists
  const fileExists = fs.existsSync(OUTPUT_FILE);

  if (fileExists) {
    console.log('[info] Output file exists, will merge and deduplicate...');

    // Read existing signatures
    const existingData = fs.readFileSync(OUTPUT_FILE, 'utf-8');
    const existingSignatures = new Set(
      existingData.split('\n').filter(line => line.trim() && !line.startsWith('signature'))
    );

    // Filter only new signatures
    const newSignatures = signatures.filter(
      sig => !existingSignatures.has(sig.signature)
    );

    console.log(`[info] Existing signatures: ${existingSignatures.size}`);
    console.log(`[info] New signatures: ${newSignatures.length}`);

    if (newSignatures.length === 0) {
      console.log('[info] No new signatures to add');
      return;
    }

    // Append new signatures (without header)
    const csvLines = newSignatures.map(sig => sig.signature);
    fs.appendFileSync(OUTPUT_FILE, csvLines.join('\n') + '\n');

    console.log(`[ok] Added ${newSignatures.length} new signatures`);

  } else {
    console.log('[info] Creating new output file...');

    // Create new file with header and signatures
    const csvLines = ['signature']; // Header
    csvLines.push(...signatures.map(sig => sig.signature));

    fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n') + '\n');

    console.log(`[ok] Created file with ${signatures.length} signatures`);
  }
}

// Main execution
const LIMIT_PER_PROGRAM = parseInt(process.argv[2] || '1000', 10);

console.log('Starting swap transaction fetch...\n');
fetchSwapTransactions(LIMIT_PER_PROGRAM)
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n[error] Fatal error:', error);
    process.exit(1);
  });
