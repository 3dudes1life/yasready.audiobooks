import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { materializeBookOneDirectEditionBatch, YASREADY_AUDIOBOOKS_VERSION } from './index.js';

const args = process.argv.slice(2);
function flag(name, fallback = null) { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

const resultPath = args[0];
const productionRoot = flag('--production-root');
const outputRoot = flag('--out');
if (!resultPath || !productionRoot) {
  console.error('Usage: node src/direct-edition-cli.js <batch-result.json> --production-root DIR [--out DIR]');
  process.exitCode = 2;
} else {
  const batchResult = await json(resultPath);
  const result = await materializeBookOneDirectEditionBatch({ batchResult, productionRoot, outputRoot });
  console.log(JSON.stringify({ version: YASREADY_AUDIOBOOKS_VERSION, ...result }, null, 2));
}
