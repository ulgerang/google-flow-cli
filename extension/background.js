/**
 * Google Flow CLI Bridge - Background Service Worker (MV3)
 * Manages WebSocket connection to local CLI bridge server and relays commands to Flow tabs.
 */

const DEFAULT_PORT = 58231;
let socket = null;
let reconnectTimer = null;
let isConnecting = false;
const logs = [];

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
  const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/*' });
  if (tabs.length > 0) {
    // Focus the first matching tab
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    return tab;
  }

  if (!openIfNeeded) return null;

  log('No Google Flow tab open. Opening new tab...');
  const newTab = await chrome.tabs.create({
    url: 'https://labs.google/fx/tools/flow',
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

// Handle incoming RPC message from CLI bridge
async function handleBridgeMessage(msg) {
  const { id, action, payload } = msg;

  if (action === 'ping') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/*' });
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
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'JOB_PROGRESS' && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'JOB_PROGRESS',
        id: message.id,
        progress: message.progress
      })
    );
  }

  if (message.type === 'FLOW_TAB_READY') {
    log('Flow tab reported ready', message.url);
  }

  // Internal popup query
  if (message.type === 'GET_POPUP_STATE') {
    (async () => {
      const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/*' });
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

// Keep service worker alive periodically
setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connectToBridge();
  }
}, 5000);
