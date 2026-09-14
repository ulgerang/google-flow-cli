import http from 'http';
import { WebSocket } from 'ws';
import crypto from 'crypto';
import { BridgeServer } from './server.js';
import { DEFAULT_CONFIG } from '../config/default-config.js';

export class BridgeClient {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_CONFIG.port;
    this.host = options.host || DEFAULT_CONFIG.host;
    this.inProcessServer = null;
    this.wsClient = null;
  }

  async checkServerRunning() {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: this.host,
          port: this.port,
          path: '/status',
          timeout: 1000
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve({ running: true, ...data });
            } catch {
              resolve({ running: true, raw: body });
            }
          });
        }
      );

      req.on('error', () => {
        resolve({ running: false });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ running: false });
      });
    });
  }

  async ensureServer(onMessage) {
    const status = await this.checkServerRunning();
    if (status.running) {
      return { isExternal: true, status };
    }

    // Start in-process bridge server
    if (typeof onMessage === 'function') {
      onMessage('Starting local bridge server on port ' + this.port + '...');
    }

    this.inProcessServer = new BridgeServer({ port: this.port, host: this.host });
    await this.inProcessServer.start();

    return { isExternal: false, status: { running: true, extensionConnected: false } };
  }

  async getWsClient() {
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      return this.wsClient;
    }

    const wsUrl = `ws://${this.host}:${this.port}`;
    this.wsClient = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      this.wsClient.on('open', () => {
        this.wsClient.send(JSON.stringify({ type: 'CONTROLLER_HELLO' }));
        resolve();
      });
      this.wsClient.on('error', reject);
    });

    return this.wsClient;
  }

  async execute(action, payload = {}, options = {}) {
    const { onProgress, onStatusUpdate, timeoutMs } = options;

    const serverInfo = await this.ensureServer(onStatusUpdate);

    // If using in-process server
    if (this.inProcessServer) {
      if (!this.inProcessServer.isExtensionConnected()) {
        if (typeof onStatusUpdate === 'function') {
          onStatusUpdate('Waiting for Chrome Extension to connect (ws://127.0.0.1:' + this.port + ')...');
        }

        const connected = await this.inProcessServer.waitForExtension(30000);
        if (!connected) {
          throw new Error(
            `Chrome Extension did not connect within 30s.\n` +
            `👉 Please ensure:\n` +
            `  1. Chrome is open.\n` +
            `  2. "Google Flow CLI Bridge" extension is installed and enabled in chrome://extensions.\n` +
            `  3. Extension popup shows bridge port: ${this.port}.`
          );
        }
      }

      if (typeof onStatusUpdate === 'function') {
        onStatusUpdate('Extension connected! Sending action: ' + action);
      }

      return await this.inProcessServer.sendAction(action, payload, {
        timeoutMs,
        onProgress
      });
    }

    // If connecting to external running server, use WebSocket for live streaming
    if (!serverInfo.status.extensionConnected) {
      let isConnected = false;
      for (let i = 0; i < 30; i++) {
        const check = await this.checkServerRunning();
        if (check.extensionConnected) {
          isConnected = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (!isConnected) {
        throw new Error(
          `Bridge server is running, but Chrome Extension is not connected.\n` +
          `👉 Please make sure Google Chrome is open and the extension is active.`
        );
      }
    }

    const ws = await this.getWsClient();
    const reqId = `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const effectiveTimeoutMs = timeoutMs || DEFAULT_CONFIG.generationTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Action "${action}" timed out after ${Math.round(effectiveTimeoutMs / 1000)}s.`));
      }, effectiveTimeoutMs);

      const messageListener = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id !== reqId) return;

          if (msg.type === 'JOB_PROGRESS') {
            if (typeof onProgress === 'function') {
              onProgress(msg.progress);
            }
            return;
          }

          if (msg.type === 'PONG') {
            cleanup();
            resolve(msg);
            return;
          }

          if (msg.type === 'JOB_RESULT') {
            cleanup();
            if (msg.success) {
              resolve(msg.result);
            } else {
              reject(new Error(msg.error || 'Job failed in browser'));
            }
          }
        } catch (e) {
          // ignore parse error of unrelated message
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeListener('message', messageListener);
      };

      ws.on('message', messageListener);

      ws.send(
        JSON.stringify({
          type: 'CALL_ACTION',
          id: reqId,
          action,
          payload
        })
      );
    });
  }

  async close() {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    if (this.inProcessServer) {
      await this.inProcessServer.stop();
      this.inProcessServer = null;
    }
  }
}
