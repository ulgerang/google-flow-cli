/**
 * Google Flow DOM Automation Engine
 * Interacts directly with https://labs.google/fx/tools/flow in the browser context
 */

const FlowActions = {
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  async waitForPredicate(predicateFn, timeoutMs = 20000, intervalMs = 500) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await predicateFn();
        if (res) return res;
      } catch (err) {
        // continue polling
      }
      await this.delay(intervalMs);
    }
    throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
  },

  async waitForElement(selector, timeoutMs = 15000) {
    return this.waitForPredicate(() => {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return el;
      return null;
    }, timeoutMs);
  },

  /**
   * Dispatches synthetic events to trigger framework reactive updates
   */
  dispatchInputEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  },

  /**
   * Ensure user is inside a project
   */
  async ensureProject(projectName) {
    const currentUrl = window.location.href;
    if (currentUrl.includes('/project/')) {
      return { status: 'already_in_project', url: currentUrl };
    }

    // Try finding "New project" / "Nouveau projet" button
    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const newBtn = buttons.find((b) => {
      const text = (b.textContent || '').toLowerCase().trim();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return (
        text.includes('nouveau projet') ||
        text.includes('new project') ||
        aria.includes('nouveau projet') ||
        aria.includes('new project') ||
        text.includes('add_circle') ||
        (text.includes('add') && b.querySelector('i, svg'))
      );
    });

    if (newBtn) {
      newBtn.click();
      await this.delay(3000);
      // Wait for project URL or toolbar
      await this.waitForPredicate(() => {
        return (
          window.location.href.includes('/project/') ||
          document.querySelector('[contenteditable="true"], textarea') !== null
        );
      }, 15000);
      return { status: 'created_new_project', url: window.location.href };
    }

    // If on homepage and projects exist, open the first project card
    const firstProject = document.querySelector('[class*="card"], [class*="project"], [href*="/project/"]');
    if (firstProject) {
      firstProject.click();
      await this.delay(3000);
      return { status: 'opened_existing_project', url: window.location.href };
    }

    return { status: 'in_root', url: window.location.href };
  },

  /**
   * Switch between Image and Video mode
   */
  async switchMode(mode = 'IMAGE') {
    const targetMode = mode.toUpperCase();
    const targetTabSelector = `button[role="tab"][id*="trigger-${targetMode}"]`;
    const tabEl = document.querySelector(targetTabSelector);

    if (tabEl) {
      if (tabEl.getAttribute('aria-selected') === 'true') {
        return { mode: targetMode, alreadyActive: true };
      }
      tabEl.click();
      await this.delay(1000);
      return { mode: targetMode, switched: true };
    }

    // Fallback: search buttons by text
    const buttons = Array.from(document.querySelectorAll('button[role="tab"], button'));
    const modeBtn = buttons.find((b) => {
      const t = (b.textContent || '').trim().toLowerCase();
      if (targetMode === 'IMAGE') return t === 'image' || t.includes('image');
      if (targetMode === 'VIDEO') return t === 'vidéo' || t === 'video' || t.includes('vidéo');
      return false;
    });

    if (modeBtn) {
      modeBtn.click();
      await this.delay(1000);
      return { mode: targetMode, switched: true };
    }

    return { mode: targetMode, status: 'tab_not_found_continuing' };
  },

  /**
   * Select generation model
   */
  async selectModel(modelName) {
    if (!modelName) return null;

    // Find model selector button in bottom toolbar
    const buttons = Array.from(document.querySelectorAll('button'));
    const modelBtn = buttons.find((b) => {
      const text = b.textContent || '';
      return (
        (text.includes('Nano') ||
          text.includes('Banana') ||
          text.includes('Imagen') ||
          text.includes('Omni') ||
          text.includes('Veo')) &&
        b.offsetParent !== null
      );
    });

    if (!modelBtn) return null;

    const currentModel = modelBtn.textContent.trim().replace(/\s+/g, ' ');
    if (currentModel.toLowerCase().includes(modelName.toLowerCase())) {
      return { model: currentModel, changed: false };
    }

    // Click to open dropdown
    modelBtn.click();
    await this.delay(600);

    // Look for options
    const options = Array.from(
      document.querySelectorAll('[role="menuitem"], [role="option"], li, button')
    );
    const targetOption = options.find((opt) => {
      const text = (opt.textContent || '').toLowerCase();
      return text.includes(modelName.toLowerCase()) && opt.offsetParent !== null;
    });

    if (targetOption) {
      targetOption.click();
      await this.delay(600);
      return { model: modelName, changed: true };
    }

    // Close menu if option not found
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await this.delay(300);
    return { model: currentModel, changed: false, fallback: true };
  },

  /**
   * Select aspect ratio
   */
  async selectRatio(ratio = '16:9') {
    if (!ratio) return null;

    const buttons = Array.from(document.querySelectorAll('button'));
    const ratioBtn = buttons.find((b) => {
      const text = (b.textContent || '').trim();
      return (text === ratio || text.includes(ratio)) && b.offsetParent !== null;
    });

    if (ratioBtn) {
      ratioBtn.click();
      await this.delay(500);
      return { ratio, selected: true };
    }

    return { ratio, selected: false };
  },

  /**
   * Select video duration
   */
  async selectDuration(duration = '4s') {
    const buttons = Array.from(document.querySelectorAll('button'));
    const durBtn = buttons.find((b) => {
      const text = (b.textContent || '').trim();
      return (text === duration || text.includes(duration)) && b.offsetParent !== null;
    });

    if (durBtn) {
      durBtn.click();
      await this.delay(500);
      return { duration, selected: true };
    }

    return { duration, selected: false };
  },

  /**
   * Fill prompt into the input bar
   */
  async fillPrompt(promptText) {
    // Find prompt input
    let promptInput = document.querySelector('[contenteditable="true"]');
    if (!promptInput || promptInput.offsetParent === null) {
      promptInput = document.querySelector('textarea');
    }

    if (!promptInput) {
      throw new Error('Could not find Google Flow prompt input ([contenteditable="true"] or textarea)');
    }

    promptInput.focus();
    await this.delay(200);

    if (promptInput.hasAttribute('contenteditable')) {
      promptInput.innerText = '';
      promptInput.focus();

      // Use document.execCommand for rich text contenteditable compatibility
      const success = document.execCommand('insertText', false, promptText);
      if (!success || !promptInput.innerText.trim()) {
        promptInput.innerText = promptText;
      }
      this.dispatchInputEvents(promptInput);
    } else {
      promptInput.value = promptText;
      this.dispatchInputEvents(promptInput);
    }

    await this.delay(500);
    return { filled: true, length: promptText.length };
  },

  /**
   * Click Generate button and handle approval dialogs
   */
  async triggerGenerate() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const generateBtn = buttons.find((b) => {
      const text = (b.textContent || '').trim();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const isVisible = b.offsetParent !== null;
      return (
        isVisible &&
        (text.includes('arrow_forward') ||
          text.toLowerCase().includes('créer') ||
          text.toLowerCase().includes('generate') ||
          aria.includes('generate') ||
          aria.includes('créer'))
      );
    });

    if (!generateBtn) {
      throw new Error('Generate button not found in Google Flow toolbar');
    }

    if (generateBtn.disabled || generateBtn.getAttribute('aria-disabled') === 'true') {
      throw new Error('Generate button is currently disabled. Check prompt or credits.');
    }

    generateBtn.click();
    await this.delay(1000);

    // Check for Agent confirmation dialog ("Accepter" / "Approve")
    for (let i = 0; i < 6; i++) {
      const pageButtons = Array.from(document.querySelectorAll('button'));
      const confirmBtn = pageButtons.find((b) => {
        const text = (b.textContent || '').trim().toLowerCase();
        return (text === 'accepter' || text === 'approve' || text.includes('accepter')) && b.offsetParent !== null;
      });

      if (confirmBtn) {
        confirmBtn.click();
        await this.delay(1000);
        break;
      }
      await this.delay(500);
    }

    return { triggered: true };
  },

  /**
   * Detect newly generated images in DOM
   */
  getMediaUuids() {
    const imgs = Array.from(document.querySelectorAll('img'));
    const uuids = [];
    imgs.forEach((img) => {
      const src = img.src || '';
      const match = src.match(/media\.getMediaUrlRedirect\?name=([a-f0-9-]+)/);
      if (match && (img.naturalWidth > 150 || img.width > 150)) {
        uuids.push(match[1]);
      }
    });
    return [...new Set(uuids)];
  },

  /**
   * Wait for generated images to appear
   */
  async waitForGeneration({ initialUuids = [], timeoutMs = 180000, onProgress }) {
    const startTime = Date.now();
    let lastReport = 0;

    while (Date.now() - startTime < timeoutMs) {
      const currentUuids = this.getMediaUuids();
      // Find new UUIDs that weren't present before
      const newUuids = currentUuids.filter((uuid) => !initialUuids.includes(uuid));

      if (newUuids.length > 0) {
        return {
          success: true,
          uuids: newUuids,
          allUuids: currentUuids,
          elapsedMs: Date.now() - startTime
        };
      }

      // Check if error toast is displayed
      const errorEl = document.querySelector('[role="alert"], [class*="error"], [class*="toast"]');
      if (errorEl && errorEl.offsetParent !== null) {
        const errText = errorEl.textContent.trim();
        if (errText.length > 5 && !errText.toLowerCase().includes('success')) {
          throw new Error(`Google Flow error message detected: ${errText}`);
        }
      }

      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      if (elapsedSec > lastReport && elapsedSec % 5 === 0) {
        lastReport = elapsedSec;
        if (typeof onProgress === 'function') {
          onProgress({ elapsedSec, status: 'generating' });
        }
      }

      await this.delay(2000);
    }

    throw new Error(`Generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
  },

  /**
   * Downloads image blob using page's authenticated session and returns as base64 DataURL
   */
  async fetchMediaDataUrl(uuid) {
    const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`;
    const response = await fetch(url, { credentials: 'include' });

    if (!response.ok) {
      throw new Error(`Failed to fetch media (status: ${response.status})`);
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          uuid,
          dataUrl: reader.result,
          mimeType: blob.type,
          size: blob.size
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Scans project cards on the Flow homepage
   */
  listProjectsFromPage() {
    const cards = Array.from(
      document.querySelectorAll('[class*="card"], [class*="project"], li, article, [href*="/project/"]')
    );
    const projects = [];

    cards.forEach((card) => {
      const text = (card.textContent || '').trim();
      const link = card.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '';
      if (text.length > 2 && (link.includes('/project/') || text.includes('Modifier') || text.includes('Edit'))) {
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
        const name = lines[0] || 'Untitled Project';
        projects.push({
          name,
          url: link.startsWith('http') ? link : `https://labs.google${link}`,
          summary: lines.slice(0, 3).join(' | ')
        });
      }
    });

    return projects;
  }
};

window.FlowActions = FlowActions;
