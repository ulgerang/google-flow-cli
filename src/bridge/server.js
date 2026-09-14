import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { DEFAULT_CONFIG } from '../config/default-config.js';

export class BridgeServer {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_CONFIG.port;
    this.host = options.host || DEFAULT_CONFIG.host;
    this.httpServer = null;
    this.wss = null;
    this.extensionSocket = null;
    this.controllerSockets = new Set();
    this.pendingInternalRequests = new Map(); // id -> { resolve, reject, timer, onProgress }
    this.requestToController = new Map();     // id -> ws
    this.extensionMeta = null;
    this.flowTabState = null;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.url === '/status' || req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'running',
              port: this.port,
              extensionConnected: this.isExtensionConnected(),
              extensionMeta: this.extensionMeta,
              flowTabState: this.flowTabState
            })
          );
          return;
        }

        if (req.url === '/api/action' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const result = await this.sendAction(data.action, data.payload, {
                timeoutMs: data.timeoutMs
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, result }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws, req) => {
        logger.debug('New WebSocket connection from:', req.socket.remoteAddress);

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            this.handleMessage(msg, ws);
          } catch (e) {
            logger.warn('Error parsing incoming WebSocket message', { error: e.message });
          }
        });

        ws.on('close', () => {
          if (this.extensionSocket === ws) {
            logger.debug('Extension disconnected');
            this.extensionSocket = null;
            this.extensionMeta = null;
          }
          this.controllerSockets.delete(ws);
        });

        ws.on('error', (err) => {
          logger.debug('WebSocket error', { error: err.message });
        });
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });

      this.httpServer.listen(this.port, this.host, () => {
        logger.debug(`Bridge server listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  handleMessage(msg, ws) {
    const { type, id } = msg;

    // 1. Extension handshake
    if (type === 'EXTENSION_HELLO') {
      this.extensionSocket = ws;
      this.extensionMeta = msg;
      logger.debug('Extension announced presence', { version: msg.version });
      return;
    }

    // 2. Controller handshake
    if (type === 'CONTROLLER_HELLO') {
      this.controllerSockets.add(ws);
      logger.debug('CLI Controller connected via WebSocket');
      return;
    }

    // 3. Controller sends action via WebSocket
    if (type === 'CALL_ACTION') {
      this.controllerSockets.add(ws);
      if (!this.isExtensionConnected()) {
        ws.send(
          JSON.stringify({
            type: 'JOB_RESULT',
            id,
            success: false,
            error: 'Chrome extension is not connected.'
          })
        );
        return;
      }

      this.requestToController.set(id, ws);
      this.extensionSocket.send(
        JSON.stringify({
          id,
          action: msg.action,
          payload: msg.payload
        })
      );
      return;
    }

    // 4. Extension responds with PONG
    if (type === 'PONG') {
      this.flowTabState = {
        hasFlowTab: msg.hasFlowTab,
        tabUrl: msg.tabUrl
      };
      // Check if internal request
      const pendingInternal = this.pendingInternalRequests.get(id);
      if (pendingInternal) {
        clearTimeout(pendingInternal.timer);
        this.pendingInternalRequests.delete(id);
        pendingInternal.resolve(msg);
      }
      // Check if external controller request
      const controllerWs = this.requestToController.get(id);
      if (controllerWs && controllerWs.readyState === WebSocket.OPEN) {
        controllerWs.send(JSON.stringify(msg));
        this.requestToController.delete(id);
      }
      return;
    }

    // 5. Extension sends progress update
    if (type === 'JOB_PROGRESS') {
      const pendingInternal = this.pendingInternalRequests.get(id);
      if (pendingInternal && typeof pendingInternal.onProgress === 'function') {
        pendingInternal.onProgress(msg.progress);
      }
      const controllerWs = this.requestToController.get(id);
      if (controllerWs && controllerWs.readyState === WebSocket.OPEN) {
        controllerWs.send(JSON.stringify(msg));
      }
      return;
    }

    // 6. Extension returns result
    if (type === 'JOB_RESULT') {
      const pendingInternal = this.pendingInternalRequests.get(id);
      if (pendingInternal) {
        clearTimeout(pendingInternal.timer);
        this.pendingInternalRequests.delete(id);
        if (msg.success) {
          pendingInternal.resolve(msg.result);
        } else {
          pendingInternal.reject(new Error(msg.error || 'Job failed in browser'));
        }
      }

      const controllerWs = this.requestToController.get(id);
      if (controllerWs && controllerWs.readyState === WebSocket.OPEN) {
        controllerWs.send(JSON.stringify(msg));
        this.requestToController.delete(id);
      }
    }
  }

  isExtensionConnected() {
    return (
      this.extensionSocket !== null &&
      this.extensionSocket.readyState === WebSocket.OPEN
    );
  }

  async waitForExtension(timeoutMs = 30000, pollIntervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.isExtensionConnected()) return true;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return false;
  }

  async sendAction(action, payload = {}, options = {}) {
    if (!this.isExtensionConnected()) {
      throw new Error(
        'Chrome extension is not connected. Please ensure Chrome is open with the Google Flow extension installed.'
      );
    }

    const timeoutMs = options.timeoutMs || DEFAULT_CONFIG.generationTimeoutMs;
    const reqId = `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInternalRequests.delete(reqId);
        reject(
          new Error(`Action "${action}" timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
        );
      }, timeoutMs);

      this.pendingInternalRequests.set(reqId, {
        resolve,
        reject,
        timer,
        onProgress: options.onProgress
      });

      this.extensionSocket.send(
        JSON.stringify({
          id: reqId,
          action,
          payload
        })
      );
    });
  }

  async stop() {
    if (this.wss) {
      this.wss.close();
    }
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
    }
    this.extensionSocket = null;
    this.controllerSockets.clear();
  }
}
