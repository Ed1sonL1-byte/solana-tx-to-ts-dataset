/**
 * src/generate_manifest.js
 */
import fs from 'fs';
import path from 'path';

const OUT_DIR = process.argv[2] || 'out_ts';
const OUT_FILE = process.argv[3] || 'manifest.jsonl';

const files = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.ts')) : [];
const stream = fs.createWriteStream(OUT_FILE, { flags: 'w' });

for (const f of files) {
  const kind =
    f.includes('_system') ? 'system' :
    f.includes('_spl')    ? 'spl' :
    f.includes('_memo')   ? 'memo' :
    f.includes('_compute')? 'compute' :
    f.includes('_raw')    ? 'raw' : 'unknown';
  const rec = { file: path.join(OUT_DIR, f), kind };
  stream.write(JSON.stringify(rec) + "\n");
}
stream.end();
console.log(`[manifest] wrote ${files.length} entries to ${OUT_FILE}`);
