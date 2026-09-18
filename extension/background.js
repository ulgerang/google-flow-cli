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

// Ensure Flow tab is available. Only focus/raise the tab when the caller
// explicitly asks (e.g. `open_flow`); routine CLI actions must not steal
// window focus from whatever the user is doing.
async function getOrOpenFlowTab(openIfNeeded = true, { focus = false } = {}) {
  const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
  if (tabs.length > 0) {
    // Prefer a tab that is inside a project: after a background discard or
    // SPA restore a Flow tab can sit at the root, where most content actions
    // fail ("not inside a project") even though another tab is usable.
    const inProject = tabs.filter((t) => /\/project\//.test(t.url || ''));
    const tab = (inProject.length ? inProject : tabs)[0];
    if (focus) {
      await chrome.tabs.update(tab.id, { active: true });
    }
    return tab;
  }

  if (!openIfNeeded) return null;

  log('No Google Flow tab open. Opening new tab...');
  const newTab = await chrome.tabs.create({
    url: FLOW_HOME_URL,
    active: focus
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

// Inject a local file into Flow's file chooser through the DevTools protocol.
// Flow's upload entries open a file chooser (input.click / showOpenFilePicker);
// with interception enabled the chooser never opens and we set the file directly.
function stageFileViaFileChooser(tabId, filePath, clickAction) {
  return new Promise((resolve, reject) => {
    const target = { tabId };
    let backendNodeId = null;
    let done = false;

    const onEvent = (src, method, params) => {
      if (method === 'Page.fileChooserRequested' && params && params.backendNodeId && !done) {
        backendNodeId = params.backendNodeId;
      }
    };
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        reject(new Error('Flow did not trigger a file chooser within 12s'));
      }
    }, 12000);

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.detach(target, () => void chrome.runtime.lastError);
    };

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.attach(target, '1.3', () => {
      if (chrome.runtime.lastError) {
        done = true;
        cleanup();
        reject(new Error('debugger attach: ' + chrome.runtime.lastError.message));
        return;
      }
      const cmd = (method, params) =>
        new Promise((res, rej) =>
          chrome.debugger.sendCommand(target, method, params || {}, (r) =>
            chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r)
          )
        );

      (async () => {
        await cmd('Page.enable');
        await cmd('Page.setInterceptFileChooserDialog', { enabled: true });
        // Ask the content script to click through to the upload entry
        await new Promise((res, rej) => {
          chrome.tabs.sendMessage(tabId, { action: clickAction, payload: {} }, (response) => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else if (response && response.success === false) rej(new Error(response.error || 'click failed'));
            else res(response);
          });
        });
        while (!backendNodeId && !done) {
          await new Promise((r) => setTimeout(r, 150));
        }
        if (done) return; // timed out
        await cmd('DOM.setFileInputFiles', { files: [filePath], backendNodeId });
        done = true;
        cleanup();
        resolve({ staged: true });
      })().catch((err) => {
        if (!done) {
          done = true;
          cleanup();
          reject(err);
        }
      });
    });
  });
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
        const mediaPayload = { ...payload };
        // A bare UUID can only construct an unsigned flow-content.google
        // URL, which the CDN rejects with 401. Resolve the tile's currently
        // signed src from the page first.
        if (!mediaPayload.src && mediaPayload.uuid) {
          const resolved = await dispatchContentAction('list_media', {}, id);
          const items = resolved?.response?.result?.items || [];
          const hit = items.find((i) => i.uuid === mediaPayload.uuid && i.src);
          if (hit) mediaPayload.src = hit.src;
        }
        const result = await fetchMediaInBackground(mediaPayload);
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
    const tab = await getOrOpenFlowTab(true, { focus: true });
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
    const result = await dispatchContentAction(action, payload, id);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'JOB_RESULT',
          id,
          success: result.response ? (result.response.success ?? false) : false,
          result: result.response?.result,
          error: result.error || result.response?.error
        })
      );
    }
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

/**
 * Send a content action to the best Flow tab. A tab whose content script is
 * missing ("Receiving end does not exist" — e.g. a tab opened before the
 * extension was installed, or restored after a background discard) is skipped
 * in favour of other candidates, and as a last resort the tab is reloaded once
 * to re-inject the content scripts.
 */
async function dispatchContentAction(action, payload, id) {
  const sendTo = (tabId) =>
    new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action, payload, id }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve({ response });
        }
      });
    });

  let tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
  if (tabs.length === 0) {
    const opened = await getOrOpenFlowTab(true);
    if (!opened) return { error: 'Unable to find or open Google Flow tab' };
    tabs = [opened];
  }

  // Tabs inside a project first (see getOrOpenFlowTab), then the rest.
  const inProject = tabs.filter((t) => /\/project\//.test(t.url || ''));
  const ordered = inProject.concat(tabs.filter((t) => !inProject.includes(t)));

  for (const tab of ordered) {
    log(`Dispatching action "${action}" to Flow tab ${tab.id}`);
    const { error, response } = await sendTo(tab.id);
    if (!error) return { response };
    log(`Content script error on ${action} (tab ${tab.id})`, error);
  }

  // Nobody answered: reload the best candidate to re-inject the content script.
  const tab = ordered[0];
  log(`Reloading Flow tab ${tab.id} to re-inject the content script`);
  try {
    await chrome.tabs.reload(tab.id);
  } catch (e) {
    return { error: `Content script not ready or error: no Flow tab responded (${e.message})` };
  }
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
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
  await new Promise((r) => setTimeout(r, 2000));

  const { error, response } = await sendTo(tab.id);
  if (!error) return { response };
  return {
    error: `Content script not ready or error: ${error}. Please refresh the Google Flow page.`
  };
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

  if (message.type === 'BG_STAGE_FRAME_FILE') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
        if (tabs.length === 0) throw new Error('No Google Flow tab is open');
        const tab = tabs[0];
        const result = await stageFileViaFileChooser(tab.id, message.payload.filePath, 'click_media_upload_entry');
        sendResponse(result);
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
