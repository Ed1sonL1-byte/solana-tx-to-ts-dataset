/**
 * src/extract_and_decompile_public_rpc.js
 */
import fs from 'fs';
import path from 'path';
import { Connection } from '@solana/web3.js';

// RPC endpoints - configure via SOLANA_RPC_URL environment variable
// You can specify multiple RPC endpoints separated by commas for load balancing
// Example: SOLANA_RPC_URL="https://rpc1.example.com,https://rpc2.example.com"
const DEFAULT_RPC_LIST = 'https://api.mainnet-beta.solana.com';

const RPC_LIST = (process.env.SOLANA_RPC_URL || DEFAULT_RPC_LIST).split(',').map(s=>s.trim()).filter(Boolean);
const SIGN_FILE = process.argv[2] || 'data/signatures.csv';
const START_FROM_SIG = process.argv[3]; // Optional: start from specific signature
const OUT_JSONL_DIR = path.resolve('out_jsonl');
const OUT_TS_DIR = path.resolve('out_ts');

if (!fs.existsSync(SIGN_FILE)) {
  console.error("Missing signatures CSV. Usage: node src/extract_and_decompile_public_rpc.js data/signatures.csv [start_signature]");
  process.exit(1);
}
fs.mkdirSync(OUT_JSONL_DIR, { recursive: true });
fs.mkdirSync(OUT_TS_DIR, { recursive: true });

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10); // Match number of RPC endpoints (5 paid RPCs)
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const BASE_BACKOFF_MS = 1000; // Increased from 500ms to 1000ms
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10); // Increased timeout
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '0', 10); // No delay between batches since we have per-RPC delays
const PER_RPC_DELAY_MS = 300; // 0.3 second delay between requests to the same RPC

let rpcIndex = -1; // Start at -1 so first call gives index 0
const rpcStats = {}; // Track usage stats per RPC
const rpcLastUsed = {}; // Track last request time per RPC

async function nextRpc() {
  rpcIndex = (rpcIndex + 1) % RPC_LIST.length;
  const rpc = RPC_LIST[rpcIndex];

  // Track stats
  if (!rpcStats[rpc]) {
    rpcStats[rpc] = { requests: 0, success: 0, failures: 0 };
  }
  rpcStats[rpc].requests++;

  if (rpcLastUsed[rpc]) {
    const timeSinceLastUse = Date.now() - rpcLastUsed[rpc];
    if (timeSinceLastUse < PER_RPC_DELAY_MS) {
      await wait(PER_RPC_DELAY_MS - timeSinceLastUse);
    }
  }
  rpcLastUsed[rpc] = Date.now();

  return rpc;
}

function logRpcStats() {
  console.log('\n[RPC Stats]');
  for (const [rpc, stats] of Object.entries(rpcStats)) {
    const successRate = stats.requests > 0 ? (stats.success / stats.requests * 100).toFixed(1) : 0;
    console.log(`  ${rpc.replace('https://', '')}`);
    console.log(`    Requests: ${stats.requests}, Success: ${stats.success}, Failures: ${stats.failures} (${successRate}% success)`);
  }
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function cachePathForSig(sig) { return path.join(OUT_JSONL_DIR, `${sig}.json`); }
function isCached(sig) { return fs.existsSync(cachePathForSig(sig)); }
function writeCache(sig, obj) { fs.writeFileSync(cachePathForSig(sig), JSON.stringify(obj)); }
function readCache(sig) { return JSON.parse(fs.readFileSync(cachePathForSig(sig), 'utf8')); }
function safeName(s) { return s.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,120); }

async function fetchParsedTx(sig) {
  if (isCached(sig)) return readCache(sig);
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    const rpc = await nextRpc();
    const conn = new Connection(rpc, { commitment: 'finalized' });
    try {
      const parsed = await Promise.race([
        conn.getParsedTransaction(sig, { commitment: 'finalized' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), REQUEST_TIMEOUT_MS))
      ]);
      if (parsed) {
        rpcStats[rpc].success++;
        writeCache(sig, parsed);
        return parsed;
      }
      const raw = await Promise.race([
        conn.getTransaction(sig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), REQUEST_TIMEOUT_MS))
      ]);
      if (raw) {
        rpcStats[rpc].success++;
        writeCache(sig, raw);
        return raw;
      }
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
      await wait(backoff + Math.random()*100);
    } catch (e) {
      rpcStats[rpc].failures++;
      // Special handling for 429 errors - use longer backoff
      const is429 = e.message && (e.message.includes('429') || e.message.includes('Too Many Requests'));
      const backoff = is429 ? BASE_BACKOFF_MS * Math.pow(3, attempt) : BASE_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(`[warn] rpc=${rpc.replace('https://', '').slice(0, 30)} attempt=${attempt} sig=${sig.slice(0, 8)}... err=${e.message.slice(0, 50)}. backoff ${backoff}ms`);
      await wait(backoff + Math.random()*150);
    }
  }
  throw new Error(`Failed to fetch ${sig} after ${MAX_RETRIES} attempts`);
}

function renderCompleteTransactionTS(params) {
  const { sig, instructions, accounts, computeBudget } = params;

  // Determine what imports we need based on instructions
  const needsSPLToken = instructions.some(i => i.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const needsToken2022 = instructions.some(i => i.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  const needsMemo = instructions.some(i => i.programId.includes('Memo'));

  let imports = `import {
  Transaction,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  Keypair
} from '@solana/web3.js';`;

  if (needsSPLToken) {
    imports += `\nimport { TOKEN_PROGRAM_ID } from '@solana/spl-token';`;
  }
  if (needsToken2022) {
    imports += `\nimport { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';`;
  }

  return `// Reconstructed from on-chain transaction: ${sig}
// Source: https://solscan.io/tx/${sig}
// Instruction count: ${instructions.length}
// Programs: ${[...new Set(instructions.map(i => i.programId.slice(0, 8)))].join(', ')}...
${imports}

/**
 * executeSkill - Auto-generated from real on-chain transaction
 *
 * This transaction demonstrates:
${instructions.map((instr, idx) => `//   ${idx + 1}. ${instr.description}`).join('\n')}
 *
 * @param blockhash - Recent blockhash from the network
 * @returns Base64 encoded serialized transaction
 */
export async function executeSkill(blockhash: string): Promise<string> {
  const tx = new Transaction();

  // Note: Replace this with your actual agent pubkey
  const agentPubkey = new PublicKey('${accounts[0] || 'REPLACE_WITH_YOUR_PUBKEY'}');

${computeBudget ? `  // Compute budget from original transaction
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: ${computeBudget} }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
` : ''}
${instructions.map((instr, idx) => {
  // Identify accounts that need keypairs (writable accounts that aren't the fee payer)
  const keypairAccounts = [];
  instr.keys.forEach((k, kidx) => {
    if (k.isWritable && k.isSigner && k.pubkey !== accounts[0]) {
      keypairAccounts.push({ index: kidx, pubkey: k.pubkey });
    }
  });

  let code = `  // Instruction ${idx + 1}: ${instr.description}\n`;

  // Generate keypairs for new accounts
  keypairAccounts.forEach((_acc, accIdx) => {
    code += `  const newAccount${idx}_${accIdx} = Keypair.generate();\n`;
  });

  code += `  tx.add(new TransactionInstruction({
    programId: new PublicKey('${instr.programId}'),
    keys: [
${instr.keys.map((k, kidx) => {
  // Check if this key needs a generated keypair
  const keypairIdx = keypairAccounts.findIndex(acc => acc.index === kidx);
  const pubkeyExpr = keypairIdx >= 0
    ? `newAccount${idx}_${keypairIdx}.publicKey`
    : (k.pubkey === accounts[0] ? 'agentPubkey' : `new PublicKey('${k.pubkey}')`);
  return `      { pubkey: ${pubkeyExpr}, isSigner: ${k.isSigner}, isWritable: ${k.isWritable} }`;
}).join(',\n')}
    ],
    data: Buffer.from('${instr.data}', 'base64')
  }));`;

  // Add partial signing for generated keypairs
  if (keypairAccounts.length > 0) {
    code += `\n  // Sign with newly created accounts\n`;
    keypairAccounts.forEach((_acc, accIdx) => {
      code += `  tx.partialSign(newAccount${idx}_${accIdx});\n`;
    });
  }

  return code;
}).join('\n\n')}

  // Set transaction properties
  tx.recentBlockhash = blockhash;
  tx.feePayer = agentPubkey;

  // Return serialized transaction
  return tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false
  }).toString('base64');
}

// === Transaction Metadata ===
// Unique accounts involved: ${accounts.length}
${accounts.slice(0, 10).map((acc, i) => `// ${i + 1}. ${acc}`).join('\n')}
${accounts.length > 10 ? `// ... and ${accounts.length - 10} more accounts` : ''}
`;
}

function decompileToTS(sig, parsed) {
  const message = parsed?.transaction?.message || parsed?.message || parsed;
  const instructions = message?.instructions || parsed?.transaction?.instructions || [];

  if (!instructions || instructions.length === 0) return null;

  // Extract all unique accounts from the transaction
  const accountKeys = message?.accountKeys || [];
  const uniqueAccounts = new Set();

  // Build detailed instruction list preserving all data
  const detailedInstructions = [];
  let computeBudget = null;

  for (const instr of instructions) {
    // Extract program ID
    let programId;
    if (instr.programId && typeof instr.programId.toBase58 === 'function') {
      programId = instr.programId.toBase58();
    } else if (instr.programId && instr.programId.toString) {
      programId = instr.programId.toString();
    } else if (instr.program === 'system') {
      programId = '11111111111111111111111111111111';
    } else if (instr.programIdIndex !== undefined && accountKeys[instr.programIdIndex]) {
      const pk = accountKeys[instr.programIdIndex];
      programId = (typeof pk.toBase58 === 'function') ? pk.toBase58() : pk.toString();
    } else {
      programId = instr.program || 'unknown';
    }

    uniqueAccounts.add(programId);

    // Check for compute budget instruction
    if (programId === 'ComputeBudget111111111111111111111111111111') {
      // Try to extract compute unit limit
      if (instr.parsed?.type === 'setComputeUnitLimit') {
        computeBudget = instr.parsed.info?.units || 200000;
      }
      continue; // Skip adding compute budget to instruction list
    }

    // Extract instruction description
    let description = 'Unknown instruction';
    if (instr.parsed) {
      description = instr.parsed.type || 'parsed instruction';
      if (instr.parsed.info) {
        const info = instr.parsed.info;
        if (info.lamports) description += ` (${info.lamports} lamports)`;
        if (info.amount) description += ` (amount: ${info.amount})`;
        if (info.mint) description += ` (mint: ${info.mint.slice(0, 8)}...)`;
      }
    } else if (programId.includes('Memo')) {
      description = 'Memo';
    } else if (programId === '11111111111111111111111111111111') {
      description = 'System instruction';
    } else if (programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
      description = 'SPL Token instruction';
    } else {
      description = `Program ${programId.slice(0, 8)}... instruction`;
    }

    // Extract accounts (keys) with metadata
    const keys = [];

    if (instr.accounts && Array.isArray(instr.accounts)) {
      // Raw transaction format with account indices
      for (const accIdx of instr.accounts) {
        if (accountKeys[accIdx]) {
          const pk = accountKeys[accIdx];
          const pubkeyStr = (typeof pk.toBase58 === 'function') ? pk.toBase58() : pk.toString();
          uniqueAccounts.add(pubkeyStr);

          // Try to determine if signer/writable from message header
          const header = message?.header || {};
          const numSigners = header.numRequiredSignatures || 0;
          const numWritable = numSigners + (accountKeys.length - (header.numReadonlySignedAccounts || 0) - (header.numReadonlyUnsignedAccounts || 0));

          keys.push({
            pubkey: pubkeyStr,
            isSigner: accIdx < numSigners,
            isWritable: accIdx < numWritable
          });
        }
      }
    } else if (instr.parsed?.info) {
      // Parsed transaction - extract from info object
      const info = instr.parsed.info;

      // Common patterns for account extraction
      const accountFields = [
        { field: 'source', isSigner: true, isWritable: true },
        { field: 'destination', isSigner: false, isWritable: true },
        { field: 'owner', isSigner: true, isWritable: false },
        { field: 'authority', isSigner: true, isWritable: false },
        { field: 'mint', isSigner: false, isWritable: true },
        { field: 'account', isSigner: false, isWritable: true },
        { field: 'tokenAccount', isSigner: false, isWritable: true },
        { field: 'multisigAuthority', isSigner: false, isWritable: false },
        { field: 'newAccount', isSigner: false, isWritable: true },
        { field: 'fromPubkey', isSigner: true, isWritable: true },
        { field: 'toPubkey', isSigner: false, isWritable: true }
      ];

      for (const { field, isSigner, isWritable } of accountFields) {
        if (info[field] && typeof info[field] === 'string') {
          uniqueAccounts.add(info[field]);
          keys.push({
            pubkey: info[field],
            isSigner,
            isWritable
          });
        }
      }
    }

    // Extract instruction data
    let data = '';
    if (instr.data) {
      if (typeof instr.data === 'string') {
        data = instr.data; // Assume base64
      } else if (Buffer.isBuffer(instr.data)) {
        data = instr.data.toString('base64');
      }
    }

    detailedInstructions.push({
      programId,
      description,
      keys,
      data
    });
  }

  // Determine transaction kind based on dominant instruction type
  let kind = 'complex';
  if (detailedInstructions.length === 1) {
    const pid = detailedInstructions[0].programId;
    if (pid === '11111111111111111111111111111111') kind = 'system';
    else if (pid === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') kind = 'spl-token';
    else if (pid.includes('Memo')) kind = 'memo';
    else kind = 'program';
  } else if (detailedInstructions.length > 1) {
    kind = `multi-${detailedInstructions.length}`;
  }

  const ts = renderCompleteTransactionTS({
    sig,
    instructions: detailedInstructions,
    accounts: Array.from(uniqueAccounts),
    computeBudget
  });

  return { kind, ts };
}

async function run() {
  const lines = fs.readFileSync(SIGN_FILE, 'utf8').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const allSigs = lines.map(l => l.split(',')[0]).filter(l => l && !l.startsWith('#'));

  let sigs = allSigs;
  let skipInfo = '';

  // If START_FROM_SIG is provided, find it and start from there
  if (START_FROM_SIG) {
    const startIndex = allSigs.indexOf(START_FROM_SIG);
    if (startIndex === -1) {
      console.error(`[error] Start signature not found: ${START_FROM_SIG}`);
      process.exit(1);
    }
    sigs = allSigs.slice(startIndex);
    skipInfo = `; starting from signature at index ${startIndex}`;
  } else {
    // Skip first 2000 signatures (default behavior)
    const SKIP_COUNT = 2000;
    sigs = allSigs.slice(SKIP_COUNT);
    skipInfo = `; skipping first ${SKIP_COUNT}`;
  }

  console.log(`[info] loaded ${allSigs.length} signatures total${skipInfo}; processing ${sigs.length}; RPC pool size=${RPC_LIST.length}`);

  // simple chunked concurrency without extra deps
  async function processSig(sig) {
    try {
      let parsed = isCached(sig) ? readCache(sig) : await fetchParsedTx(sig);
      const de = decompileToTS(sig, parsed || {});
      if (de) {
        const fn = safeName(`${sig}_${de.kind}.ts`);
        fs.writeFileSync(path.join(OUT_TS_DIR, fn), de.ts, 'utf8');
        console.log(`[ok] ${sig} -> ${fn}`);
      } else {
        console.warn(`[no-decompile] ${sig}`);
      }
    } catch (e) {
      console.error(`[error] ${sig}: ${e.message}`);
    }
  }

  let i = 0;
  const startTime = Date.now();

  console.log(`[info] RPC endpoints:`);
  RPC_LIST.forEach((rpc, idx) => console.log(`  ${idx + 1}. ${rpc}`));
  console.log('');

  while (i < sigs.length) {
    const batch = sigs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processSig));
    i += CONCURRENCY;

    // Progress report every 10 batches
    if (i % (CONCURRENCY * 10) === 0 || i >= sigs.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (i / elapsed).toFixed(2);
      console.log(`[progress] ${i}/${sigs.length} processed (${rate} tx/s, ${elapsed}s elapsed)`);
    }

    // Add longer delay between batches to respect rate limits
    if (i < sigs.length) {
      await wait(BATCH_DELAY_MS);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[done] Processed ${sigs.length} transactions in ${totalTime}s`);
  console.log(`[done] TS files in out_ts/, caches in out_jsonl/`);

  // Show RPC statistics
  logRpcStats();
}

run().catch(e => { console.error(e); process.exit(1); });
