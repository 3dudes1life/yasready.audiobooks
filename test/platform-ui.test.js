import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { withYasReadyPlatformUI } from '../src/ui/yasready-platform.js';

const body = '<main><button id="approve">Approve Fix</button><audio controls src="preview.wav"></audio><script>const workflow = "$&";</script></main>';
const original = '<!doctype html><html><head><title>Review</title></head><body>' + body + '</body></html>';
test('shared chrome preserves workflow markup and does not duplicate on repeated rendering', () => {
  const html = withYasReadyPlatformUI(original);
  assert.ok(html.includes(body));
  assert.equal(withYasReadyPlatformUI(html), html);
  assert.match(html, /<html lang="en">/);
  assert.equal((html.match(/data-yasready-platform="1"/g) || []).length, 1);
  assert.match(html, /aria-label="YasReady platform"/);
});
test('incomplete templates cannot silently lose the shared shell', () => {
  assert.throws(() => withYasReadyPlatformUI('<main>Review</main>'), /complete review page/);
});
function themeEnvironment(saved, storageBlocked = false) {
  const listeners = {}, button = { textContent: '', attrs: {}, setAttribute(k,v){ this.attrs[k]=v; }, getAttribute(k){ return this.attrs[k]; }, addEventListener(k,v){ this[k]=v; } };
  const root = { dataset: {}, style: {} }, writes = [];
  const script = withYasReadyPlatformUI(original).match(/<script data-yasready-platform-theme>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, {
    document: { documentElement: root, querySelector: () => button, addEventListener: (k,v) => listeners[k]=v },
    localStorage: { getItem(){ if(storageBlocked) throw Error('unavailable'); return saved; }, setItem(k,v){ if(storageBlocked) throw Error('unavailable'); writes.push([k,v]); } },
    matchMedia: () => ({ matches: true }), addEventListener: (k,v) => listeners[k]=v
  });
  listeners.DOMContentLoaded();
  return { root, button, listeners, writes };
}
test('theme respects preference, exposes accessible toggle and syncs same-origin review tabs', () => {
  const env = themeEnvironment('light');
  assert.equal(env.root.dataset.theme, 'light');
  assert.equal(env.button.attrs['aria-label'], 'Switch to dark mode');
  env.button.click();
  assert.equal(env.root.dataset.theme, 'dark');
  assert.deepEqual(env.writes, [['yasready-theme','dark']]);
  env.listeners.storage({key:'yasready-theme',newValue:'light'});
  assert.equal(env.root.dataset.theme, 'light');
});
test('review remains usable when browser storage is blocked', () => {
  const env = themeEnvironment(null, true);
  assert.equal(env.root.dataset.theme, 'dark');
  assert.doesNotThrow(() => env.button.click());
  assert.equal(env.root.dataset.theme, 'light');
});

test('presentation upgrade preserves an original backup and refuses to overwrite it', async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(),'yasready-ui-'));
  const file = join(dir,'review.html');
  const before = original.replace('<title>Review</title>', '<title>YasReady Review</title>');
  const script = new URL('../scripts/apply-platform-theme.mjs',import.meta.url);
  try {
    await writeFile(file,before);
    execFileSync(process.execPath,[script.pathname,file]);
    assert.equal(await readFile(file,'utf8'),before);
    execFileSync(process.execPath,[script.pathname,file,'--apply']);
    assert.equal(await readFile(join(dir,'review.before-platform-ui.html'),'utf8'),before);
    assert.ok((await readFile(file,'utf8')).includes(body));
    execFileSync(process.execPath,[script.pathname,file,'--apply']);
    await writeFile(file,before);
    assert.throws(()=>execFileSync(process.execPath,[script.pathname,file,'--apply'],{stdio:'pipe'}));
    assert.equal(await readFile(file,'utf8'),before);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
