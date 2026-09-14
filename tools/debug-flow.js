#!/usr/bin/env node
/**
 * Debug helper: dump the Flow page's automation-relevant DOM via the extension.
 * Usage: node tools/debug-flow.js [--menus]
 */
import { BridgeClient } from '../src/bridge/client.js';

const client = new BridgeClient({});
try {
  const result = await client.execute(
    'debug_dom',
    {
      options: {
        menus: process.argv.includes('--menus'),
        promptBarHtml: process.argv.includes('--prompt-bar'),
        tiles: true
      }
    },
    { timeoutMs: 15000 }
  );
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('debug_dom failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
