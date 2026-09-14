/**
 * Google Flow DOM Automation Engine
 * Interacts directly with https://flow.google.com (formerly labs.google/fx/tools/flow)
 *
 * UI notes (verified 2026-09 on flow.google.com, Korean locale):
 * - The editor prompt bar is a ProseMirror contenteditable div.
 * - Model / aspect ratio / outputs / image-video mode live in a settings panel
 *   opened by a button with aria-label "설정 트리거" (settings trigger). The
 *   trigger text also shows the current state, e.g. "🍌 Nano Banana 2 crop_16_9 x1".
 *   Inside the panel, options are buttons with role="radio" whose text contains
 *   Material icon ligatures (e.g. "crop_16_916:9", "videocam동영상", "x2").
 * - The model family dropdown inside the panel has aria-label "모델 제품군 선택".
 * - The generate button has aria-label "생성 시작" and contains the Material
 *   ligature "arrow_forward"; it is disabled until a prompt is entered.
 * - There are no Image/Video tabs anymore; the mode radio inside the settings
 *   panel switches between image and video model families.
 * All matching below is locale-tolerant (KO/EN/FR) because aria labels follow
 * the Google account language.
 */

const ICON_LIGATURE_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9_]+)+\b/g; // e.g. crop_16_9, arrow_forward

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

  visibleButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"]')).filter(
      (b) => b.offsetParent !== null
    );
  },

  /**
   * Strips Material icon ligatures and counter tokens from button text so the
   * human-readable label can be compared ("🍌 Nano Banana 2 crop_16_9 x1" -> "Nano Banana 2").
   */
  cleanLabel(text) {
    return (text || '')
      .replace(ICON_LIGATURE_RE, ' ')
      .replace(/\bx\d+\b/gi, ' ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

    // "New project" tile — locale tolerant (KO/EN/FR/JA)
    const newProjectRe = /새\s*프로젝트|new project|nouveau projet|新規プロジェクト|new project/i;
    const newBtn = this.visibleButtons().find((b) => {
      const text = (b.textContent || '').trim();
      const aria = (b.getAttribute('aria-label') || '').trim();
      return newProjectRe.test(text) || newProjectRe.test(aria);
    });

    if (newBtn) {
      newBtn.click();
      await this.delay(3000);
      // Wait for project URL or prompt bar
      await this.waitForPredicate(() => {
        return (
          window.location.href.includes('/project/') ||
          document.querySelector('div.ProseMirror[contenteditable="true"], [contenteditable="true"], textarea') !== null
        );
      }, 15000);
      return { status: 'created_new_project', url: window.location.href };
    }

    // If on homepage and projects exist, open the first project card
    const firstProject = document.querySelector('a[href*="/project/"]');
    if (firstProject) {
      firstProject.click();
      await this.delay(3000);
      return { status: 'opened_existing_project', url: window.location.href };
    }

    return { status: 'in_root', url: window.location.href };
  },

  // ------------------------------------------------------------------
  // Settings panel (model / ratio / outputs / mode)
  // ------------------------------------------------------------------

  async findSettingsTrigger() {
    const buttons = this.visibleButtons();
    return buttons.find((b) => {
      const aria = b.getAttribute('aria-label') || '';
      if (/설정\s*트리거|settings|param[eè]tres?/i.test(aria)) return true;
      const t = (b.textContent || '').replace(/\s+/g, ' ');
      return /x\d/i.test(t) && /(Nano|Banana|Imagen|Veo|Omni)/i.test(t);
    });
  },

  async isSettingsOpen() {
    const radios = Array.from(document.querySelectorAll('[role="radio"]')).filter(
      (r) => r.offsetParent !== null
    );
    // The settings panel is the only place exposing ratio/outputs radio groups.
    return radios.some((r) => {
      const t = (r.textContent || '').trim();
      return /^\d+\s*:\s*\d+$/.test(t) || /^x\d+$/i.test(t) || /crop_\d+_\d+/.test(t);
    });
  },

  async openSettings() {
    if (await this.isSettingsOpen()) return;
    const trigger = await this.findSettingsTrigger();
    if (!trigger) throw new Error('Flow settings trigger button not found in the prompt bar');
    trigger.click();
    await this.waitForPredicate(() => this.isSettingsOpen(), 8000, 300);
    await this.delay(300);
  },

  async closeSettings() {
    if (!(await this.isSettingsOpen())) return;
    const trigger = await this.findSettingsTrigger();
    if (trigger) trigger.click();
    await this.delay(400);
    if (await this.isSettingsOpen()) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await this.delay(300);
    }
  },

  panelRadios() {
    return Array.from(document.querySelectorAll('[role="radio"]')).filter(
      (r) => r.offsetParent !== null
    );
  },

  /**
   * Extract the human label of a settings radio. The radio's raw textContent
   * concatenates the Material icon ligature with the label ("crop_16_9" + "16:9"
   * -> "crop_16_916:9"), so digit-bearing ratios must be read from the deepest
   * child element whose text is exactly the label.
   */
  radioLabel(radio) {
    const descendants = radio.querySelectorAll('*');
    let label = null;
    descendants.forEach((s) => {
      if (s.children.length > 0) return;
      const t = (s.textContent || '').trim();
      if (/^\d+\s*:\s*\d+$/.test(t) || /^x\d+$/i.test(t) || /^\d+\s*(s|초|sec)$/i.test(t)) {
        label = t;
      }
    });
    if (label) return label;
    const aria = (radio.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    return (radio.textContent || '').trim();
  },

  /**
   * Switch between Image and Video mode via the settings panel radios
   */
  async switchMode(mode = 'IMAGE') {
    const wantVideo = String(mode).toUpperCase() === 'VIDEO';

    // The mode is also detectable when the panel is closed via the trigger text.
    await this.openSettings();
    const radios = this.panelRadios();
    const target = radios.find((r) => {
      const t = (r.textContent || '').toLowerCase();
      return wantVideo
        ? /videocam|동영상|video|vidéo/.test(t)
        : /\bimage\b|이미지|photo/.test(t);
    });

    if (!target) {
      await this.closeSettings();
      return { mode: wantVideo ? 'VIDEO' : 'IMAGE', status: 'mode_radio_not_found' };
    }

    const alreadyActive = target.getAttribute('aria-checked') === 'true';
    if (!alreadyActive) {
      target.click();
      await this.delay(1200); // switching family re-renders the panel options
    }
    await this.closeSettings();
    return { mode: wantVideo ? 'VIDEO' : 'IMAGE', switched: !alreadyActive, alreadyActive };
  },

  /**
   * Select generation model via the settings panel model-family dropdown
   */
  async selectModel(modelName) {
    if (!modelName) return null;

    const trigger = await this.findSettingsTrigger();
    if (trigger) {
      const current = this.cleanLabel(trigger.textContent);
      if (current.toLowerCase().includes(modelName.toLowerCase())) {
        return { model: current, changed: false, alreadyActive: true };
      }
    }

    await this.openSettings();

    const familyBtn = this.visibleButtons().find((b) => {
      const aria = b.getAttribute('aria-label') || '';
      return /모델 제품군|model famil|mod[eè]le|choose model/i.test(aria);
    });

    if (familyBtn) {
      familyBtn.click();
      await this.delay(800);
    }

    // Find a visible option matching the requested model. Exclude controls that
    // belong to the settings panel itself (trigger, family button, x-count radios).
    const candidates = Array.from(
      document.querySelectorAll('[role="menuitem"], [role="option"], [role="radio"], [role="button"], button, li')
    );
    const exclude = new Set();
    if (familyBtn) exclude.add(familyBtn);
    if (trigger) exclude.add(trigger);
    const target = candidates.find((opt) => {
      if (!opt.offsetParent || exclude.has(opt)) return false;
      const label = this.cleanLabel(opt.textContent);
      if (!label || /^x\d+$/i.test(label)) return false;
      const aria = opt.getAttribute('aria-label') || '';
      if (/설정\s*트리거|모델 제품군|settings/i.test(aria)) return false;
      return label.toLowerCase().includes(modelName.toLowerCase());
    });

    if (target) {
      target.click();
      await this.delay(1000);
      await this.closeSettings();
      const after = await this.findSettingsTrigger();
      return { model: modelName, changed: true, active: after ? this.cleanLabel(after.textContent) : null };
    }

    await this.closeSettings();
    return { model: modelName, changed: false, fallback: true };
  },

  /**
   * Select aspect ratio via the settings panel ratio radios
   */
  async selectRatio(ratio = '16:9') {
    if (!ratio) return null;
    const wanted = String(ratio).replace(/\s/g, '');

    await this.openSettings();
    const target = this.panelRadios().find((r) => {
      const label = (this.radioLabel(r) || '').replace(/\s/g, '');
      return label === wanted;
    });

    if (!target) {
      await this.closeSettings();
      return { ratio, selected: false };
    }

    const changed = target.getAttribute('aria-checked') !== 'true';
    if (changed) {
      target.click();
      await this.delay(500);
    }
    await this.closeSettings();
    return { ratio, selected: true, changed };
  },

  /**
   * Select video duration via the settings panel (visible only in video mode).
   * Labels are either "4s"/"8s" or localized like "4초".
   */
  async selectDuration(duration = '4s') {
    if (!duration) return null;
    const seconds = (String(duration).match(/(\d+)/) || [])[1];

    await this.openSettings();
    const target = this.panelRadios().find((r) => {
      const label = (this.radioLabel(r) || '').replace(/\s+/g, ' ').trim();
      if (/^x\d+$/i.test(label)) return false;
      const mSec = label.match(/^(\d+)\s*(s|초|sec)$/i);
      return mSec && seconds && mSec[1] === seconds;
    });

    if (!target) {
      await this.closeSettings();
      return { duration, selected: false };
    }

    const changed = (target.getAttribute('aria-checked') || 'false') !== 'true';
    if (changed) {
      target.click();
      await this.delay(500);
    }
    await this.closeSettings();
    return { duration, selected: true, changed };
  },

  /**
   * Select the number of outputs per generation (x1..x4) in the settings panel
   */
  async selectOutputs(count = 1) {
    const n = parseInt(count, 10);
    if (!n || n < 1 || n > 4) return { outputs: count, selected: false, error: 'outputs must be 1-4' };

    await this.openSettings();
    const target = this.panelRadios().find((r) => {
      const t = (r.textContent || '').trim().toLowerCase();
      return t === `x${n}`;
    });

    if (!target) {
      await this.closeSettings();
      return { outputs: n, selected: false };
    }

    const changed = target.getAttribute('aria-checked') !== 'true';
    if (changed) {
      target.click();
      await this.delay(500);
    }
    await this.closeSettings();
    return { outputs: n, selected: true, changed };
  },

  /**
   * Read the current generation settings without changing anything
   */
  async readGenerationSettings() {
    const trigger = await this.findSettingsTrigger();
    if (!trigger) return null;
    const raw = (trigger.textContent || '').replace(/\s+/g, ' ').trim();

    let model = this.cleanLabel(raw);
    let ratio = null;
    let outputs = null;
    let mode = null;

    const numeric = raw.match(/crop_(\d+)_(\d+)/);
    if (numeric) {
      ratio = `${numeric[1]}:${numeric[2]}`;
    } else {
      const named = raw.match(/crop_(square|portrait|landscape)/);
      if (named) {
        ratio = { square: '1:1', portrait: '3:4', landscape: '4:3' }[named[1]];
      }
    }
    const outMatch = raw.match(/\bx(\d+)\b/i);
    if (outMatch) outputs = parseInt(outMatch[1], 10);
    if (/videocam/i.test(raw)) mode = 'VIDEO';
    else if (/image/i.test(raw) && !/videocam/i.test(raw)) mode = 'IMAGE';

    return { model, ratio, outputs, mode, raw };
  },

  // ------------------------------------------------------------------
  // Prompt & generation
  // ------------------------------------------------------------------

  /**
   * Fill prompt into the ProseMirror input bar
   */
  async fillPrompt(promptText) {
    // The new editor is a ProseMirror contenteditable; fall back to any
    // contenteditable or textarea.
    let promptInput =
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"]');

    if (!promptInput || promptInput.offsetParent === null) {
      promptInput = document.querySelector('textarea');
    }

    if (!promptInput) {
      throw new Error('Could not find Google Flow prompt input (ProseMirror/contenteditable/textarea)');
    }

    promptInput.focus();
    await this.delay(200);

    if (promptInput.hasAttribute('contenteditable')) {
      // ProseMirror keeps undo state; select-all + delete clears reliably.
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const success = document.execCommand('insertText', false, promptText);
      if (!success || !(promptInput.innerText || '').includes(promptText.slice(0, 40))) {
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
    const generateBtn = this.visibleButtons().find((b) => {
      const aria = b.getAttribute('aria-label') || '';
      const text = (b.textContent || '').trim();
      return (
        /생성\s*시작|generate|créer|create/i.test(aria) ||
        text.includes('arrow_forward')
      );
    });

    if (!generateBtn) {
      throw new Error('Generate button not found in Google Flow prompt bar');
    }

    if (generateBtn.disabled || generateBtn.getAttribute('aria-disabled') === 'true') {
      throw new Error('Generate button is disabled. Check the prompt or your remaining credits.');
    }

    generateBtn.click();
    await this.delay(1000);

    // Some flows (agent mode / content policy) show a confirmation dialog.
    for (let i = 0; i < 6; i++) {
      const confirmBtn = this.visibleButtons().find((b) => {
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return (
          /^(accepter|approve|accept|수락|허용|동의|확인|계속)$/.test(text) ||
          /^(accepter|approve|accept|수락|허용|동의|확인|계속)$/.test(aria)
        );
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
   * Detect generated media in the DOM.
   * The current Flow UI renders media tiles as <img src="https://flow.google.com/asb/<token>">
   * (opaque signed URLs, no UUID). Legacy tiling URLs with media UUIDs are still
   * recognized for backward compatibility. Returns deduped items keyed by src.
   */
  getMediaItems() {
    const uuidFromSrc = (src) => {
      if (!src) return null;
      const redirect = src.match(/media(?:\.getMediaUrlRedirect)?\?name=([a-f0-9-]{36})/i);
      if (redirect) return redirect[1];
      const plain = src.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      return plain ? plain[1] : null;
    };

    const seen = new Set();
    const items = [];
    Array.from(document.querySelectorAll('img')).forEach((img) => {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:') || seen.has(src)) return;
      if (img.naturalWidth > 150 || img.width > 150) {
        seen.add(src);
        items.push({ src, uuid: uuidFromSrc(src), width: img.naturalWidth || img.width });
      }
    });
    return items;
  },

  /**
   * Legacy helper: UUIDs only (may be empty on the new /asb/ URL scheme)
   */
  getMediaUuids() {
    return [...new Set(this.getMediaItems().map((i) => i.uuid).filter(Boolean))];
  },

  /**
   * Wait for new media items (images/videos) to appear
   */
  async waitForGeneration({ initialKeys = [], timeoutMs = 180000, onProgress }) {
    const startTime = Date.now();
    let lastReport = 0;

    while (Date.now() - startTime < timeoutMs) {
      const items = this.getMediaItems();
      const newItems = items.filter((i) => !initialKeys.includes(i.src));

      if (newItems.length > 0) {
        return {
          success: true,
          items: newItems,
          allItems: items,
          elapsedMs: Date.now() - startTime
        };
      }

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
   * Download media using the page's authenticated session.
   * Accepts either an opaque tile src (new UI) or a legacy media UUID.
   * Same-origin URLs (/asb/ tiles) are fetched directly. Freshly generated
   * media uses signed cross-origin CDN URLs (flow-content.google) which only
   * the extension background can fetch (host permissions + no CORS), so those
   * are routed through the background service worker.
   */
  async fetchMediaDataUrl({ src, uuid } = {}) {
    const isCrossOrigin = (() => {
      if (!src) return false;
      try {
        return new URL(src).hostname !== window.location.hostname;
      } catch {
        return false;
      }
    })();

    if (isCrossOrigin || (!src && uuid)) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ type: 'BG_FETCH_MEDIA', payload: { src, uuid } }, (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (resp && resp.error) {
              reject(new Error(resp.error));
            } else if (resp && resp.dataUrl) {
              resolve(resp);
            } else {
              reject(new Error('Background media fetch returned no payload'));
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    const candidates = [];
    if (src) {
      if (/=s\d+/.test(src)) {
        candidates.push(src.replace(/=s\d+[^=]*$/, '=s0'));
      }
      candidates.push(src);
    }

    let lastError = null;
    for (const url of candidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
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
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return { src: src || null, uuid: uuid || null, dataUrl, mimeType: blob.type, size: blob.size, fetchedUrl: url };
        } catch (err) {
          lastError = err;
        }
      }
    }

    throw new Error(
      `Failed to fetch media (${uuid || (src || '').slice(0, 60)}) with browser credentials: ${lastError?.message || 'unknown error'}`
    );
  },

  /**
   * Scans project cards on the Flow homepage
   */
  listProjectsFromPage() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/project/"]'));
    const seen = new Set();
    const projects = [];

    anchors.forEach((a) => {
      const href = a.href || '';
      try {
        // Only real project links — exclude ?continue=... query params on
        // sign-out/account links that merely embed a project URL.
        const u = new URL(href);
        if (!/^\/project\/[a-f0-9-]+$/i.test(u.pathname)) return;
      } catch {
        return;
      }
      const match = href.match(/\/project\/([a-f0-9-]+)/i);
      if (!match) return;
      const uuid = match[1];
      if (seen.has(uuid)) return;
      seen.add(uuid);

      // The project title sits near the card. Material icon ligatures
      // ("edit"/"delete") and nav labels are filtered out.
      let card = a.closest('li, article, [role="listitem"]') || a.parentElement;
      for (let i = 0; i < 3 && card && card.textContent.length < 10; i++) card = card.parentElement;
      let name = '';
      if (card) {
        const lines = (card.textContent || '')
          .split('\n')
          .map((l) => l.replace(/\b(edit|delete|editdelete)\b/gi, '').trim())
          .filter((l) => l.length > 1 && !/^(프로젝트 열기|open project|ouvrir le projet)$/i.test(l));
        name = lines[lines.length - 1] || lines[0] || '';
      }
      if (!name) name = a.getAttribute('aria-label') || 'Untitled Project';

      projects.push({
        name,
        uuid,
        url: `https://flow.google.com/project/${uuid}`,
        summary: (a.getAttribute('aria-label') || '').slice(0, 120)
      });
    });

    return projects;
  },

  /**
   * List characters defined in the project (sidebar "캐릭터" / "Characters" tab).
   * Clicks the sidebar tab and collects the character tiles.
   */
  async listCharactersFromPage() {
    const sidebarBtn = this.visibleButtons().find((b) => {
      const text = (b.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = (b.getAttribute('aria-label') || '');
      return /캐릭터|character|personnage/i.test(text) || /캐릭터|characters?$/i.test(aria);
    });

    if (!sidebarBtn) {
      // Not in a project or the sidebar is collapsed
      return { inProject: window.location.href.includes('/project/'), characters: [] };
    }

    sidebarBtn.click();
    await this.delay(1500);

    // Character tiles: grab candidate labels after navigation
    const labels = new Set();
    Array.from(document.querySelectorAll('[role="listitem"], li, article, [class*="tile"], [class*="card"]')).forEach(
      (el) => {
        if (!el.offsetParent) return;
        const text = this.cleanLabel(el.textContent);
        if (text && text.length <= 60 && !/전체 미디어|all media|장면|scene|도구|tools|휴지통|trash/i.test(text)) {
          labels.add(text);
        }
      }
    );

    return {
      inProject: window.location.href.includes('/project/'),
      characters: [...labels].slice(0, 50)
    };
  },

  /**
   * Debug helper: snapshot the current DOM structure relevant to automation.
   * Helps diagnose selector drift when Google updates the Flow UI.
   */
  inspectDom(options = {}) {
    const result = {
      url: window.location.href,
      title: document.title,
      inProject: window.location.href.includes('/project/'),
      buttons: [],
      editables: [],
      projectLinks: [],
      mediaImgs: 0,
      tabs: []
    };

    if (options.buttons !== false) {
      result.buttons = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"]'))
        .filter((b) => b.offsetParent !== null)
        .slice(0, 80)
        .map((b) => ({
          tag: b.tagName.toLowerCase(),
          text: (b.textContent || '').trim().slice(0, 60).replace(/\s+/g, ' '),
          aria: (b.getAttribute('aria-label') || '').slice(0, 80),
          role: b.getAttribute('role'),
          checked: b.getAttribute('aria-checked'),
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true'
        }));
    }

    if (options.editables !== false) {
      result.editables = Array.from(
        document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"], [role="textbox"]')
      )
        .filter((el) => el.offsetParent !== null || el.isContentEditable)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          contenteditable: el.getAttribute('contenteditable'),
          role: el.getAttribute('role'),
          aria: (el.getAttribute('aria-label') || '').slice(0, 80),
          placeholder:
            el.getAttribute('placeholder') ||
            el.getAttribute('data-placeholder') ||
            (el.querySelector('[data-placeholder], [data-leaf-placeholder], [class*="placeholder"]')?.textContent || '').slice(0, 60),
          classes: (el.className || '').toString().slice(0, 120),
          focused: el === document.activeElement
        }));
    }

    result.projectLinks = Array.from(document.querySelectorAll('a[href*="/project/"]'))
      .map((a) => a.href)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 20);

    result.imgs = Array.from(document.querySelectorAll('img'))
      .filter((img) => img.naturalWidth > 100 || img.width > 100)
      .slice(0, 15)
      .map((img) => ({
        src: (img.src || '').slice(0, 160),
        w: img.width,
        h: img.height
      }));

    result.mediaImgs = this.getMediaUuids().length;

    result.tabs = Array.from(document.querySelectorAll('button[role="tab"]'))
      .filter((t) => t.offsetParent !== null)
      .map((t) => ({
        id: t.id,
        text: (t.textContent || '').trim().slice(0, 40),
        selected: t.getAttribute('aria-selected') === 'true'
      }));

    if (options.menus) {
      result.menus = Array.from(
        document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [role="menuitem"], [role="option"]')
      )
        .filter((m) => m.offsetParent !== null)
        .slice(0, 40)
        .map((m) => ({
          role: m.getAttribute('role'),
          text: (m.textContent || '').trim().slice(0, 100).replace(/\s+/g, ' '),
          aria: (m.getAttribute('aria-label') || '').slice(0, 80)
        }));
    }

    return result;
  }
};

window.FlowActions = FlowActions;
