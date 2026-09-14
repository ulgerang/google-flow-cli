import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { WebSocket } from 'ws';
import { BridgeServer } from '../src/bridge/server.js';
import { BridgeClient } from '../src/bridge/client.js';
import { saveMediaItem } from '../src/utils/file-saver.js';

async function runMockTest() {
  console.log('🧪 Starting Google Flow Bridge & CLI Protocol Mock Test...\n');

  const testPort = 58244;
  const server = new BridgeServer({ port: testPort });
  await server.start();
  console.log('✔ BridgeServer started on test port', testPort);

  // 1. Connect a simulated Chrome Extension
  const mockExtensionWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
  let extensionConnected = false;

  await new Promise((resolve, reject) => {
    mockExtensionWs.on('open', () => {
      extensionConnected = true;
      // Send HELLO
      mockExtensionWs.send(
        JSON.stringify({
          type: 'EXTENSION_HELLO',
          version: '1.0.0'
        })
      );
      resolve();
    });
    mockExtensionWs.on('error', reject);
  });

  console.log('✔ Simulated Chrome Extension connected via WebSocket');
  assert.strictEqual(extensionConnected, true, 'Extension should connect successfully');

  // Set up mock extension message responder
  mockExtensionWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    console.log(`  [MockExtension] Received RPC action: "${msg.action}" (id: ${msg.id})`);

    if (msg.action === 'ping') {
      mockExtensionWs.send(
        JSON.stringify({
          type: 'PONG',
          id: msg.id,
          hasFlowTab: true,
          tabUrl: 'https://labs.google/fx/tools/flow/project/test-123'
        })
      );
    } else if (msg.action === 'generate_image') {
      // Send a simulated progress event
      mockExtensionWs.send(
        JSON.stringify({
          type: 'JOB_PROGRESS',
          id: msg.id,
          progress: { elapsedSec: 5, status: 'generating' }
        })
      );

      // Return a simulated image result with 1x1 test PNG base64
      setTimeout(() => {
        mockExtensionWs.send(
          JSON.stringify({
            type: 'JOB_RESULT',
            id: msg.id,
            success: true,
            result: {
              status: 'success',
              prompt: msg.payload.prompt,
              model: msg.payload.model,
              ratio: msg.payload.ratio,
              elapsedMs: 6200,
              media: [
                {
                  uuid: 'test-uuid-456',
                  dataUrl:
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                  mimeType: 'image/png',
                  size: 68
                }
              ]
            }
          })
        );
      }, 300);
    } else if (msg.action === 'list_projects') {
      mockExtensionWs.send(
        JSON.stringify({
          type: 'JOB_RESULT',
          id: msg.id,
          success: true,
          result: [
            { name: 'Cyberpunk City', url: 'https://labs.google/fx/tools/flow/project/1', summary: 'Sci-fi visuals' }
          ]
        })
      );
    }
  });

  // 2. Test BridgeClient communicating with the server
  const client = new BridgeClient({ port: testPort });

  // Test status check
  const status = await client.checkServerRunning();
  console.log('✔ BridgeClient status check:', status.running ? 'Server Running' : 'Failed');
  assert.strictEqual(status.running, true);
  assert.strictEqual(status.extensionConnected, true);

  // Test ping action
  const pingRes = await client.execute('ping', {});
  console.log('✔ Ping response:', pingRes);
  assert.strictEqual(pingRes.hasFlowTab, true);

  // Test generate_image action
  let progressReceived = false;
  const genRes = await client.execute(
    'generate_image',
    {
      prompt: 'A futuristic city at sunrise',
      model: 'Nano Banana 2',
      ratio: '16:9'
    },
    {
      onProgress: (p) => {
        progressReceived = true;
        console.log(`✔ Received streaming progress: ${p.elapsedSec}s elapsed`);
      }
    }
  );

  console.log('✔ Image generation result received:', genRes.status, `(${genRes.media.length} image)`);
  assert.strictEqual(genRes.status, 'success');
  assert.strictEqual(genRes.media.length, 1);
  assert.strictEqual(progressReceived, true, 'Progress callback should have triggered');

  // Test saveMediaItem
  const testOutputDir = path.resolve('test_output');
  const saved = await saveMediaItem({
    outputDir: testOutputDir,
    type: 'image',
    data: genRes.media[0].dataUrl,
    metadata: {
      prompt: genRes.prompt,
      model: genRes.model,
      test: true
    }
  });

  console.log('✔ Saved media file verified:', saved.filePath, `(${saved.size} bytes)`);
  assert(fs.existsSync(saved.filePath), 'Saved image file must exist on disk');

  // Clean up test output
  if (fs.existsSync(testOutputDir)) {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  }

  // 3. Clean shutdown
  mockExtensionWs.close();
  await client.close();
  await server.stop();

  console.log('\n🎉 ALL MOCK TESTS PASSED SUCCESSFULLY!\n');
}

runMockTest().catch((err) => {
  console.error('\n❌ Mock test failed:', err);
  process.exit(1);
});
