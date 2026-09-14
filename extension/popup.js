/**
 * Google Flow CLI Bridge - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const bridgeStatus = document.getElementById('bridge-status');
  const bridgeUrl = document.getElementById('bridge-url');
  const tabStatus = document.getElementById('tab-status');
  const tabDetail = document.getElementById('tab-detail');
  const portInput = document.getElementById('port-input');
  const btnSavePort = document.getElementById('btn-save-port');
  const btnOpenFlow = document.getElementById('btn-open-flow');
  const btnRefresh = document.getElementById('btn-refresh');
  const logsContainer = document.getElementById('logs-container');

  // Load saved port
  const data = await chrome.storage.local.get(['bridgePort']);
  const port = data.bridgePort || 58231;
  portInput.value = port;
  bridgeUrl.textContent = `ws://127.0.0.1:${port}`;

  // Save port handler
  btnSavePort.addEventListener('click', async () => {
    const newPort = parseInt(portInput.value, 10);
    if (newPort > 1024 && newPort < 65535) {
      await chrome.storage.local.set({ bridgePort: newPort });
      bridgeUrl.textContent = `ws://127.0.0.1:${newPort}`;
      btnSavePort.textContent = 'Saved!';
      setTimeout(() => {
        btnSavePort.textContent = 'Save';
      }, 1500);
      // Notify background script to reconnect
      chrome.runtime.reload();
    }
  });

  // Open Google Flow tab handler
  btnOpenFlow.addEventListener('click', async () => {
    chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' });
  });

  // Refresh status
  async function refreshState() {
    chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' });
  }

  btnRefresh.addEventListener('click', refreshState);

  // Listen for state from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'POPUP_STATE') {
      const state = message.state;

      // Update bridge status
      if (state.bridgeConnected) {
        bridgeStatus.textContent = 'Connected';
        bridgeStatus.className = 'status-pill status-connected';
      } else {
        bridgeStatus.textContent = 'Disconnected';
        bridgeStatus.className = 'status-pill status-disconnected';
      }

      // Update Flow tab status
      if (state.flowTab) {
        tabStatus.textContent = 'Open & Active';
        tabStatus.className = 'status-pill status-connected';
        tabDetail.textContent = state.flowTab.title || state.flowTab.url;
        btnOpenFlow.textContent = 'Switch to Flow Tab';
        btnOpenFlow.onclick = () => {
          chrome.tabs.update(state.flowTab.id, { active: true });
        };
      } else {
        tabStatus.textContent = 'Not Open';
        tabStatus.className = 'status-pill status-warning';
        tabDetail.textContent = 'No active Flow tab detected';
        btnOpenFlow.textContent = 'Open Google Flow';
        btnOpenFlow.onclick = () => {
          chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' });
        };
      }

      // Update logs
      if (state.logs && state.logs.length > 0) {
        logsContainer.innerHTML = '';
        state.logs.forEach((log) => {
          const div = document.createElement('div');
          div.className = 'log-entry';
          div.innerHTML = `<span class="log-time">[${log.time}]</span> ${log.message}`;
          logsContainer.appendChild(div);
        });
      }
    }
  });

  // Initial load
  refreshState();
  setInterval(refreshState, 2000);
});
