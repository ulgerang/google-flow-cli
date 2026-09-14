/**
 * Google Flow CLI Bridge - Background Service Worker (MV3)
 * Manages WebSocket connection to local CLI bridge server and relays commands to Flow tabs.
 */

const DEFAULT_PORT = 58231;
// Google Flow moved from labs.google/fx to flow.google.com (labs.google redirects there).
const FLOW_TAB_PATTERNS = ['*://labs.google/fx/*', '*://flow.google.com/*'];
const FLOW_HOME_URL = 'https://flow.google.com/';
let socket = null;
let reconnectTimer = null;
let isConnecting = false;
let pingTimer = null;
const logs = [];

// Chrome suspends MV3 service workers after ~30s without events. Since Chrome 116,
// WebSocket activity resets that idle timer, so we ping the bridge periodically.
function startPingLoop() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'PING', time: new Date().toISOString() }));
    }
  }, 20000);
}

function stopPingLoop() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function log(message, meta = null) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    message,
    meta
  };
  logs.unshift(entry);
  if (logs.length > 50) logs.pop();
  console.log(`[FlowBridge] ${message}`, meta || '');
}

async function getBridgePort() {
  const data = await chrome.storage.local.get(['bridgePort']);
  return data.bridgePort || DEFAULT_PORT;
}

// Connect to local CLI WebSocket bridge
async function connectToBridge() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (isConnecting) return;
  isConnecting = true;

  const port = await getBridgePort();
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      isConnecting = false;
      log(`Connected to CLI bridge on ${wsUrl}`);
      startPingLoop();
      // Announce presence
      socket.send(
        JSON.stringify({
          type: 'EXTENSION_HELLO',
          version: chrome.runtime.getManifest().version,
          time: new Date().toISOString()
        })
      );
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        await handleBridgeMessage(message);
      } catch (e) {
        log('Error parsing bridge message', e.message);
      }
    };

    socket.onerror = (err) => {
      isConnecting = false;
    };

    socket.onclose = () => {
      isConnecting = false;
      socket = null;
      stopPingLoop();
      scheduleReconnect();
    };
  } catch (err) {
    isConnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectToBridge();
  }, 2500);
}

// Ensure Flow tab is available
async function getOrOpenFlowTab(openIfNeeded = true) {
  const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
  if (tabs.length > 0) {
    // Focus the first matching tab
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    return tab;
  }

  if (!openIfNeeded) return null;

  log('No Google Flow tab open. Opening new tab...');
  const newTab = await chrome.tabs.create({
    url: FLOW_HOME_URL,
    active: true
  });

  // Wait for tab to complete loading
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === newTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });

  // Small delay for content script initialization
  await new Promise((r) => setTimeout(r, 2000));
  return newTab;
}

// Media CDN URLs (flow-content.google) are cross-origin to the Flow page, so
// the content script cannot fetch them (CORS). The service worker can, thanks
// to host_permissions.
function bytesToDataUrl(bytes, mimeType) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mimeType || 'application/octet-stream'};base64,` + btoa(binary);
}

// Inject a local file into the page's file input through the DevTools protocol.
function debuggerCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params || {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function attachFileViaDebugger(tabId, filePath) {
  const target = { tabId };
  await new Promise((resolve, reject) => {
    chrome.debugger.attach(target, '1.3', () => {
      if (chrome.runtime.lastError) reject(new Error('debugger attach: ' + chrome.runtime.lastError.message));
      else resolve();
    });
  });

  try {
    const doc = await debuggerCommand(target, 'DOM.getDocument', { depth: 1 });
    const node = await debuggerCommand(target, 'DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]'
    });
    if (!node || !node.nodeId) {
      throw new Error('file input disappeared before the file could be set');
    }
    await debuggerCommand(target, 'DOM.setFileInputFiles', {
      files: [filePath],
      nodeId: node.nodeId
    });
  } finally {
    // Detach right away; the change event processes independently.
    chrome.debugger.detach(target, () => void chrome.runtime.lastError);
  }
}

async function fetchMediaInBackground(payload) {
  const candidates = [];
  if (payload.src) candidates.push(payload.src);
  if (payload.uuid) {
    candidates.push(`https://flow-content.google/image/${payload.uuid}`);
    candidates.push(`https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${payload.uuid}`);
  }

  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const blob = await response.blob();
      if (!blob.size || !/^(image|video)\//.test(blob.type)) {
        lastError = new Error(`Unexpected content-type ${blob.type}`);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return {
        src: payload.src || null,
        uuid: payload.uuid || null,
        dataUrl: bytesToDataUrl(bytes, blob.type),
        mimeType: blob.type,
        size: blob.size,
        via: 'background'
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Background media fetch failed for ${payload.uuid || (payload.src || '').slice(0, 60)}: ${lastError?.message || 'unknown'}`
  );
}

// Handle incoming RPC message from CLI bridge
async function handleBridgeMessage(msg) {
  const { id, action, payload } = msg;

  if (action === 'ping') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
      socket.send(
        JSON.stringify({
          type: 'PONG',
          id,
          hasFlowTab: tabs.length > 0,
          tabUrl: tabs[0]?.url || null
        })
      );
    }
    return;
  }

  if (action === 'set_frame') {
    // Frames-to-Video: put a local file into the 시작/끝 frame slot of the
    // video prompt bar (slot picker + debugger file injection).
    try {
      const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
      if (tabs.length === 0) throw new Error('No Google Flow tab is open');
      const tab = tabs[0];

      const sendToContent = (act, pl) =>
        new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: act, payload: pl || {}, id }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message + ' — refresh the Flow page'));
            } else if (response && response.success === false) {
              reject(new Error(response.error || 'Content action failed'));
            } else {
              resolve(response ? response.result : null);
            }
          });
        });

      const opened = await sendToContent('select_frame_slot', { slot: payload.slot || 'start' });
      if (!opened || !opened.fileInput) {
        throw new Error('Frame slot did not expose a file input');
      }
      await attachFileViaDebugger(tab.id, payload.filePath);
      const filled = await sendToContent('wait_frame_filled', { slot: payload.slot || 'start', timeoutMs: 30000 });
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'JOB_RESULT', id, success: true, result: filled }));
      }
    } catch (err) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'JOB_RESULT', id, success: false, error: err.message }));
      }
    }
    return;
  }

  if (action === 'attach_ref_file') {
    // Reference image upload: Flow only accepts files through its own picker
    // (hidden <input type=file>). We drive that picker and inject the file via
    // the Chrome DevTools protocol (chrome.debugger), which can set input files.
    try {
      const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
      if (tabs.length === 0) throw new Error('No Google Flow tab is open');
      const tab = tabs[0];

      const sendToContent = (act, pl) =>
        new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: act, payload: pl || {}, id }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message + ' — refresh the Flow page'));
            } else if (response && response.success === false) {
              reject(new Error(response.error || 'Content action failed'));
            } else {
              resolve(response ? response.result : null);
            }
          });
        });

      const picker = await sendToContent('open_upload_picker');
      if (!picker || !picker.fileInput) {
        throw new Error('Flow did not expose a file input for the upload picker');
      }

        await attachFileViaDebugger(tab.id, payload.filePath);

        // Wait until Flow registers the upload (ingredient chip / progress starts)
        const attached = await sendToContent('wait_ingredient_attached', { timeoutMs: 20000 });
        // Close the asset picker dialog that Flow leaves open
        await sendToContent('close_ingredient_panel').catch(() => null);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'JOB_RESULT', id, success: true, result: attached }));
        }
    } catch (err) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'JOB_RESULT', id, success: false, error: err.message }));
      }
    }
    return;
  }

  if (action === 'reload_extension') {
    // Dev convenience: reload this extension from the CLI. After the restart,
    // startup logic below re-injects content scripts by reloading Flow tabs.
    try {
      await chrome.storage.local.set({ reloadTabsOnStartup: true });
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: 'JOB_RESULT',
            id,
            success: true,
            result: { reloading: true }
          })
        );
      }
    } catch (err) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'JOB_RESULT', id, success: false, error: err.message }));
      }
    }
    setTimeout(() => chrome.runtime.reload(), 300);
    return;
  }

  if (action === 'fetch_media') {
    const srcHost = (() => {
      try {
        return payload?.src ? new URL(payload.src).hostname : null;
      } catch {
        return null;
      }
    })();
    // Content script can only fetch same-origin media; route the rest here.
    if ((srcHost && srcHost !== 'flow.google.com' && srcHost !== 'labs.google') || (!srcHost && payload?.uuid && !payload?.src)) {
      try {
        const result = await fetchMediaInBackground(payload || {});
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'JOB_RESULT', id, success: true, result }));
        }
      } catch (err) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'JOB_RESULT', id, success: false, error: err.message }));
        }
      }
      return;
    }
    // fall through to content script for same-origin media
  }

  if (action === 'open_flow') {
    const tab = await getOrOpenFlowTab(true);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'JOB_RESULT',
          id,
          success: true,
          result: { tabId: tab.id, url: tab.url }
        })
      );
    }
    return;
  }

  // Get or open Flow tab for content actions
  try {
    const tab = await getOrOpenFlowTab(true);
    if (!tab) {
      throw new Error('Unable to find or open Google Flow tab');
    }

    log(`Dispatching action "${action}" to Flow tab ${tab.id}`);

    // Send action to content script
    chrome.tabs.sendMessage(tab.id, { action, payload, id }, (response) => {
      if (chrome.runtime.lastError) {
        log(`Content script error on ${action}`, chrome.runtime.lastError.message);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'JOB_RESULT',
              id,
              success: false,
              error: `Content script not ready or error: ${chrome.runtime.lastError.message}. Please refresh the Google Flow page.`
            })
          );
        }
        return;
      }

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: 'JOB_RESULT',
            id,
            success: response?.success ?? false,
            result: response?.result,
            error: response?.error
          })
        );
      }
    });
  } catch (err) {
    log(`Error handling bridge message: ${err.message}`);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'JOB_RESULT',
          id,
          success: false,
          error: err.message
        })
      );
    }
  }
}

// Forward content script events (e.g. progress) to CLI bridge
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'JOB_PROGRESS' && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'JOB_PROGRESS',
        id: message.id,
        progress: message.progress
      })
    );
  }

  if (message.type === 'BG_ATTACH_REF') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
        if (tabs.length === 0) throw new Error('No Google Flow tab is open');
        const tab = tabs[0];

        const sendToContent = (act, pl) =>
          new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { action: act, payload: pl || {} }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message + ' — refresh the Flow page'));
              } else if (response && response.success === false) {
                reject(new Error(response.error || 'Content action failed'));
              } else {
                resolve(response ? response.result : null);
              }
            });
          });

        const picker = await sendToContent('open_upload_picker');
        if (!picker || !picker.fileInput) {
          throw new Error('Flow did not expose a file input for the upload picker');
        }
        await attachFileViaDebugger(tab.id, message.payload.filePath);
        const attached = await sendToContent('wait_ingredient_attached', { timeoutMs: 20000 });
        await sendToContent('close_ingredient_panel').catch(() => null);
        sendResponse({ attached: attached && attached.attached });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true; // async sendResponse
  }

  if (message.type === 'BG_SET_FRAME') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
        if (tabs.length === 0) throw new Error('No Google Flow tab is open');
        const tab = tabs[0];

        const sendToContent = (act, pl) =>
          new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { action: act, payload: pl || {} }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message + ' — refresh the Flow page'));
              } else if (response && response.success === false) {
                reject(new Error(response.error || 'Content action failed'));
              } else {
                resolve(response ? response.result : null);
              }
            });
          });

        const opened = await sendToContent('select_frame_slot', { slot: message.payload.slot });
        if (!opened || !opened.fileInput) {
          throw new Error('Frame slot did not expose a file input');
        }
        await attachFileViaDebugger(tab.id, message.payload.filePath);
        const filled = await sendToContent('wait_frame_filled', { slot: message.payload.slot, timeoutMs: 30000 });
        sendResponse({ filled: !!(filled && filled.filled), slot: message.payload.slot });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true; // async sendResponse
  }

  if (message.type === 'BG_FETCH_MEDIA') {
    fetchMediaInBackground(message.payload || {})
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async sendResponse
  }

  if (message.type === 'FLOW_TAB_READY') {
    log('Flow tab reported ready', message.url);
  }

  // Internal popup query
  if (message.type === 'GET_POPUP_STATE') {
    (async () => {
      const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
      const port = await getBridgePort();
      chrome.runtime.sendMessage({
        type: 'POPUP_STATE',
        state: {
          bridgeConnected: !!socket && socket.readyState === WebSocket.OPEN,
          bridgePort: port,
          flowTab: tabs[0] ? { id: tabs[0].id, title: tabs[0].title, url: tabs[0].url } : null,
          logs
        }
      });
    })();
    return true;
  }
});

// Start connection on launch
connectToBridge();

// After a bridge-triggered extension reload, refresh open Flow tabs so their
// content scripts reconnect to the new extension instance.
(async () => {
  try {
    const { reloadTabsOnStartup } = await chrome.storage.local.get(['reloadTabsOnStartup']);
    if (reloadTabsOnStartup) {
      await chrome.storage.local.remove(['reloadTabsOnStartup']);
      const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
      tabs.forEach((t) => chrome.tabs.reload(t.id));
      log(`Reloaded ${tabs.length} Flow tab(s) after extension update`);
    }
  } catch (e) {
    // storage may be unavailable very early; ignore
  }
})();

// Backup wake-up: if the service worker still gets suspended (e.g. browser restart
// with no open socket), chrome.alarms fires periodically and revives it. The 0.5 min
// minimum period is supported since Chrome 120.
chrome.alarms.create('flow-bridge-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flow-bridge-keepalive') {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectToBridge();
    } else {
      socket.send(JSON.stringify({ type: 'PING', time: new Date().toISOString() }));
    }
  }
});

// Top-level tab listeners wake the suspended service worker on user browsing
// activity so the bridge reconnects without requiring a popup click.
chrome.tabs.onCreated.addListener(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) connectToBridge();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && (!socket || socket.readyState !== WebSocket.OPEN)) {
    connectToBridge();
  }
});

// Keep service worker alive periodically
setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connectToBridge();
  }
}, 5000);
