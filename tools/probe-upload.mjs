import { BridgeClient } from '../src/bridge/client.js';
const c = new BridgeClient({});
for (const action of ['open_project_upload', 'probe_upload_tab']) {
  try {
    const r = await c.execute(action, {}, { timeoutMs: 60000 });
    console.log(action, '->', JSON.stringify(r).slice(0, 600));
  } catch (e) { console.error(action, 'ERR', e.message); }
}
process.exit(0);
