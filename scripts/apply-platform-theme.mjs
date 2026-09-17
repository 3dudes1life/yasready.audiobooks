import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { withYasReadyPlatformUI } from '../src/ui/yasready-platform.js';

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('--'));
if (!file || args.some(arg => arg.startsWith('--') && arg !== '--apply')) throw new Error('Usage: node scripts/apply-platform-theme.mjs /path/to/review.html [--apply]');
const target = path.resolve(file);
if (!/\.html$/i.test(target)) throw new Error('Choose a generated review .html file');
const original = await readFile(target, 'utf8');
if (!/YasReady/i.test(original) || !/<title>[^<]*(?:Review|Calibration|Fidelity|Continuation|Localization)/i.test(original)) throw new Error('This does not appear to be a YasReady review page');
const updated = withYasReadyPlatformUI(original);
if (updated === original) console.log('This review already uses the shared YasReady interface.');
else if (!args.includes('--apply')) console.log('Ready to update presentation only. Add --apply to make a backup and update this review HTML.');
else {
  const backup = target.replace(/\.html$/i, '.before-platform-ui.html');
  await copyFile(target, backup, constants.COPYFILE_EXCL);
  await writeFile(target, updated, 'utf8');
  console.log('Updated YasReady presentation. Original saved as ' + backup);
}
