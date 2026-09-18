// Dump the entries Flow shows after the project "add media" button is clicked.
// Used to fix the frame-slot upload path when Google changes the menu.
import { BridgeClient } from '../src/bridge/client.js';
const c = new BridgeClient({});
try {
  const r = await c.execute('probe_media_menu', {}, { timeoutMs: 60000 });
  console.log('fileInputs on page:', r.fileInputs);
  for (const e of r.entries || []) {
    const s = ((e.text || '') + ' | ' + (e.aria || '')).trim();
    if (s.replace(/\|/g, '').trim()) console.log(`  ${e.tag} role=${e.role} :: ${s.slice(0, 90)}`);
  }
} catch (e) { console.error('ERR', e.message); }
process.exit(0);
