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
   * Navigate to the characters UI. Returns which page we landed on:
   * 'detail_page', 'create_page' or 'list_page'.
   */
  async openCharactersPage() {
    const path = window.location.pathname;
    // From a character detail page, go back to the list first
    if (/\/character\/[a-f0-9-]+/i.test(path)) {
      const back = this.visibleButtons().find((b) => /뒤로|back/i.test(b.getAttribute('aria-label') || ''));
      if (back) {
        back.click();
        await this.delay(1600);
      }
    }
    if (window.location.pathname.endsWith('/character')) return 'create_page';
    const tab =
      this.findNavElement(/^(캐릭터|characters?)$/i) || this.findNavElement(/^(캐릭터|characters?)/i);
    if (!tab) throw new Error('캐릭터 탭을 찾을 수 없습니다 — 프로젝트를 먼저 여세요 (`flow open`)');
    tab.click();
    await this.delay(2200);
    if (/\/character\/[a-f0-9-]+/i.test(window.location.pathname)) return 'detail_page';
    return window.location.pathname.endsWith('/character') ? 'create_page' : 'list_page';
  },

  /**
   * Open a specific character's detail page by label substring (list page).
   */
  async openCharacterDetail(name) {
    const page = await this.openCharactersPage();
    if (page === 'create_page') throw new Error('이 프로젝트에는 캐릭터가 없습니다');
    const q = String(name).toLowerCase();
    const card = Array.from(
      document.querySelectorAll('[class*="character-card"], [class*="character-tile"], li, article, [class*="card"]')
    ).find((c) => {
      if (!c.offsetParent) return false;
      const t = (c.textContent || '').trim();
      return t.length > 2 && t.length < 300 && t.toLowerCase().includes(q);
    });
    if (!card) throw new Error(`캐릭터를 찾을 수 없습니다: ${name}`);
    card.click();
    await this.delay(1800);
    if (!/\/character\/[a-f0-9-]+/i.test(window.location.pathname)) {
      throw new Error(`캐릭터 상세 페이지를 열지 못했습니다: ${name}`);
    }
    return { opened: true, url: window.location.pathname };
  },

  /**
   * Rename (and optionally update the personality of) the character currently
   * open in the detail page. The edit mode exposes a top title input, a
   * "캐릭터 이름" field and a "캐릭터 성격" textarea, saved with "완료".
   */
  async renameCurrentCharacter(newName, personality) {
    if (!/\/character\/[a-f0-9-]+/i.test(window.location.pathname)) {
      throw new Error('캐릭터 상세 페이지가 열려 있지 않습니다');
    }
    if (!newName && !personality) throw new Error('newName 또는 personality 중 하나는 필요합니다');

    const editBtn = this.visibleButtons().find((b) => /이름 수정|rename/i.test(b.getAttribute('aria-label') || ''));
    if (!editBtn) throw new Error('이름 수정 버튼을 찾을 수 없습니다');
    editBtn.click();
    await this.delay(700);

    const setNativeValue = (el, value) => {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    if (newName) {
      const nameInput =
        document.querySelector('input[aria-label="캐릭터 이름"], input.name-input') ||
        document.querySelector('input.editable-text-input') ||
        document.querySelector('input[type="text"]');
      if (!nameInput) throw new Error('이름 입력창이 나타나지 않았습니다');
      // Angular inputs: focus + select-all + execCommand insertText mirrors real typing
      nameInput.focus();
      await this.delay(150);
      nameInput.select && nameInput.select();
      const okCmd = document.execCommand('insertText', false, newName);
      if (!okCmd || nameInput.value !== newName) {
        setNativeValue(nameInput, newName);
      }
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      nameInput.dispatchEvent(new Event('blur', { bubbles: true }));
      await this.delay(300);
    }

    if (personality) {
      const textarea =
        document.querySelector('textarea[aria-label="캐릭터 성격"], textarea.personality-textarea') ||
        document.querySelector('textarea');
      if (!textarea) throw new Error('성격 입력창이 나타나지 않았습니다');
      textarea.focus();
      await this.delay(150);
      textarea.select && textarea.select();
      const okCmd = document.execCommand('insertText', false, personality);
      if (!okCmd || textarea.value !== personality) {
        setNativeValue(textarea, personality);
      }
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('blur', { bubbles: true }));
      await this.delay(300);
    }

    // Save with 완료 (fallback: Enter on the name input)
    const doneBtn = this.visibleButtons().find((b) => /^완료$/.test((b.textContent || '').trim()));
    if (doneBtn) {
      doneBtn.click();
    } else if (newName) {
      const nameInput = document.querySelector('input[aria-label="캐릭터 이름"], input.editable-text-input');
      if (nameInput) nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    await this.delay(1200);

    const body = document.body.textContent || '';
    return {
      renamed: newName ? body.includes(newName) : null,
      personalitySet: personality ? body.includes(personality.slice(0, 15)) : null,
      name: newName
    };
  },

  /**
   * Delete the character currently open in the detail page (휴지통 아이콘),
   * confirming the dialog. Note: the separate "이미지 삭제" button only removes
   * the portrait image.
   */
  async deleteCurrentCharacter() {
    if (!/\/character\/[a-f0-9-]+/i.test(window.location.pathname)) {
      throw new Error('캐릭터 상세 페이지가 열려 있지 않습니다');
    }
    const delBtn = this.visibleButtons().find(
      (b) => (b.getAttribute('aria-label') || '').trim() === '삭제'
    );
    if (!delBtn) throw new Error('삭제 버튼을 찾을 수 없습니다');
    delBtn.click();
    await this.delay(900);

    // Confirmation dialog
    const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button, button')).find((b) => {
      if (!b.offsetParent) return false;
      const t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).trim().toLowerCase();
      return /^(삭제|delete|확인|confirm|삭제합니다?)$/.test(t);
    });
    if (confirmBtn) {
      confirmBtn.click();
      await this.delay(1500);
    }
    const gone = !/\/character\/[a-f0-9-]+/i.test(window.location.pathname);
    return { deleted: gone };
  },

  /**
   * Create a character from a text description (Flow generates the look with
   * the current image model). Optional preset card name ("괴짜", "프로페셔널"...).
   * Resolves with the page snapshot after Flow finishes (or times out).
   */
  async createCharacter(description, presetName, timeoutMs = 120000) {
    if (!description || !description.trim()) throw new Error('캐릭터 설명(description)이 필요합니다');
    const page = await this.openCharactersPage();

    if (page === 'list_page') {
      // From the list, open the creation page
      const newBtn =
        this.visibleButtons().find((b) =>
          /신규\s*캐릭터|새\s*캐릭터|new character|캐릭터 만들/i.test(
            (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')
          )
        ) || this.findNavElement(/신규\s*캐릭터|새\s*캐릭터|new character/i);
      if (!newBtn) throw new Error('캐릭터 목록에서 만들기 버튼을 찾을 수 없습니다');
      newBtn.click();
      await this.delay(2000);
    }

    if (presetName) {
      const card = this.findNavElement(new RegExp(String(presetName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      if (card) {
        card.click();
        await this.delay(1000);
      }
    }

    const editor = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (!editor) throw new Error('캐릭터 설명 입력창을 찾을 수 없습니다');
    editor.focus();
    await this.delay(200);
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, description);
    this.dispatchInputEvents(editor);
    await this.delay(800);

    const genBtn = this.visibleButtons().find(
      (b) =>
        /생성\s*시작|create|generate/i.test(b.getAttribute('aria-label') || '') ||
        (b.textContent || '').includes('arrow_forward')
    );
    if (!genBtn) throw new Error('생성 버튼을 찾을 수 없습니다');
    if (genBtn.disabled || genBtn.getAttribute('aria-disabled') === 'true') {
      throw new Error('생성 버튼이 비활성화되어 있습니다 (설명을 입력했는지 확인하세요)');
    }
    genBtn.click();

    // Wait for the character to be created: the UI leaves the empty-editor state
    // (a character card/detail appears, or the description input resets with
    // content elsewhere). Return the extracted character info.
    let created = false;
    try {
      await this.waitForPredicate(() => {
        const urlChanged = !/\/character$/.test(window.location.pathname);
        const detail = document.querySelector('[class*="character-detail"], [class*="character-card"]');
        if (urlChanged || detail) return true;
        // The editor may reset to placeholder when creation starts listing
        const placeholder = document.querySelector('.prosemirror-placeholder');
        return false;
      }, timeoutMs, 2500);
      created = true;
    } catch (e) {
      // timeout — return current state snapshot anyway
    }
    await this.delay(1500);

    const texts = Array.from(
      document.querySelectorAll('[class*="name"], [class*="title"], [class*="character-card"], h1, h2, h3')
    )
      .filter((t) => t.offsetParent !== null)
      .slice(0, 15)
      .map((t) => (t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80))
      .filter(Boolean);

    return { created, url: window.location.pathname, texts };
  },

  /**
   * List characters defined in the project (sidebar "캐릭터" / "Characters" tab).
   * Clicks the sidebar tab and collects the character tiles.
   */
  async listCharactersFromPage() {
    const page = await this.openCharactersPage();
    if (page === 'create_page') {
      return { inProject: true, page, characters: [] };
    }

    // List page: collect character cards (name + optional description)
    const cards = Array.from(
      document.querySelectorAll('[class*="character-card"], [class*="character-tile"], [class*="preset-card-host"]')
    ).filter((c) => c.offsetParent !== null);

    const characters = [];
    const seen = new Set();
    cards.forEach((card) => {
      const label = this.cleanLabel(card.textContent);
      if (!label || seen.has(label)) return;
      seen.add(label);
      characters.push({ label: label.slice(0, 100) });
    });

    // Fallback: generic tiles with names near the sidebar content area
    if (characters.length === 0) {
      Array.from(document.querySelectorAll('li, article, [class*="tile"], [class*="card"]')).forEach((el) => {
        if (!el.offsetParent) return;
        const text = this.cleanLabel(el.textContent);
        if (
          text &&
          text.length <= 60 &&
          !/전체 미디어|all media|장면|scene|도구|tools|휴지통|trash|캐릭터|characters?|이미지|image/i.test(text) &&
          !seen.has(text)
        ) {
          seen.add(text);
          characters.push({ label: text });
        }
      });
    }

    return { inProject: window.location.href.includes('/project/'), page, characters: characters.slice(0, 50) };
  },

  /**
   * Delete a character by label substring: open its detail page and use the
   * 휴지통 (delete) button there, confirming the dialog.
   */
  async deleteCharacter(name) {
    await this.openCharacterDetail(name);
    return await this.deleteCurrentCharacter();
  },

  /**
   * Rename a character by label substring.
   */
  async renameCharacter(name, newName, personality) {
    await this.openCharacterDetail(name);
    return await this.renameCurrentCharacter(newName, personality);
  },

  /**
   * Attach a reference image (ingredient) to the prompt box without native file
   * pickers: the local file is converted to a File object and delivered through
   * synthesized drag-and-drop (Flow advertises "drop media here") and, as a
   * fallback, a paste event on the ProseMirror prompt box.
   */
  async addIngredientFromDataUrl(dataUrl, name = 'reference.png') {
    const editor = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (!editor) throw new Error('Prompt box not found — open a project first');

    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) {
      throw new Error(`Only image references are supported, got ${blob.type || 'unknown type'}`);
    }
    const file = new File([blob], name, { type: blob.type });

    // The prompt bar container reacts to drops; the editor itself is only the
    // text layer, so target its prompt-bar ancestor.
    const promptBar =
      editor.closest('[aria-label*="프롬프트"], [class*="prompt"], form') ||
      editor.parentElement?.parentElement ||
      editor;

    const countIngredientImgs = () => {
      const box = promptBar.closest('body') || document;
      // ingredient previews render as <img> thumbnails inside the prompt bar
      return promptBar.querySelectorAll('img').length;
    };
    const beforeCount = countIngredientImgs();

    const fireDataTransferEvent = (target, type) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      dt.dropEffect = 'copy';
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      target.dispatchEvent(ev);
    };

    // 1) drag-and-drop sequence on the prompt bar and the editor
    for (const target of [promptBar, editor]) {
      fireDataTransferEvent(target, 'dragenter');
      await this.delay(100);
      fireDataTransferEvent(target, 'dragover');
      await this.delay(100);
      fireDataTransferEvent(target, 'drop');
      await this.delay(700);
    }

    let added = countIngredientImgs() > beforeCount;

    // 2) paste fallback on the focused editor
    if (!added) {
      editor.focus();
      await this.delay(200);
      const dt = new DataTransfer();
      dt.items.add(file);
      const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', { value: dt });
      editor.dispatchEvent(pasteEvent);
      await this.delay(1500);
      added = countIngredientImgs() > beforeCount;
    }

    if (!added) {
      throw new Error(
        'Reference image was not attached — Flow did not react to the synthetic drop/paste events'
      );
    }

    return { added: true, name, size: blob.size, mimeType: blob.type };
  },

  /**
   * Find newly generated tiles for ingredient-based (reference) generations.
   * The project grid labels output tiles with a title derived from the prompt,
   * while uploaded reference files are labeled with their file name. We score
   * word overlap between the prompt and each tile label to tell them apart.
   */
  findGeneratedTiles(prompt, baselineKeys) {
    const stop = new Set(['this', 'that', 'with', 'from', 'into', 'make', 'make', 'a', 'an', 'the', 'of', 'in', 'on', 'to', 'and', 'for', 'version', 'image']);
    const words = (prompt || '')
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));
    const distinctive = [...new Set(words)].slice(0, 12);

    const items = this.getMediaItems().filter((i) => !baselineKeys.includes(i.src));
    if (items.length === 0) return [];

    const scored = items.map((item) => {
      // Find the tile label near the image
      const img = Array.from(document.querySelectorAll('img')).find(
        (im) => (im.currentSrc || im.src || '') === item.src
      );
      let label = '';
      if (img) {
        let el = img.parentElement;
        for (let d = 0; d < 6 && el && !label; d++) {
          const t = (el.textContent || '').trim();
          if (t.length > 3 && !/\.(jpg|jpeg|png|webp)$/i.test(t)) {
            label = t.replace(/\s+/g, ' ').toLowerCase();
          }
          el = el.parentElement;
        }
      }
      const hits = distinctive.filter((w) => label.includes(w)).length;
      return { item, label, hits };
    });

    const minHits = distinctive.length >= 2 ? 2 : 1;
    const matched = scored.filter((s) => s.hits >= minHits && !/\.(jpg|jpeg|png|webp)$/i.test(s.label));
    return matched.map((s) => s.item);
  },

  // ------------------------------------------------------------------
  // Add menu (ingredient picker) helpers
  // ------------------------------------------------------------------

  async openAddMenu() {
    // Close any leftover menu first — clicking + toggles the menu, so a stale
    // open state would close it instead of opening.
    if (document.querySelector('[role="option"], [role="dialog"]')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await this.delay(600);
    }
    const plusBtn = this.visibleButtons().find((b) =>
      /소재 추가|프롬프트 상자에/i.test(b.getAttribute('aria-label') || '')
    );
    if (!plusBtn) throw new Error('Ingredient (+) menu button not found in the prompt bar');
    plusBtn.click();
    try {
      await this.waitForPredicate(
        () => document.querySelectorAll('[role="option"]').length > 0 || !!document.querySelector('input[type="file"]'),
        8000,
        300
      );
    } catch (err) {
      // One retry after a clean escape: the first click may have toggled a
      // stale menu closed.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await this.delay(600);
      plusBtn.click();
      await this.waitForPredicate(
        () => document.querySelectorAll('[role="option"]').length > 0 || !!document.querySelector('input[type="file"]'),
        8000,
        300
      );
    }
    // Asset rows can lazy-load after the menu opens
    try {
      await this.waitForPredicate(() => document.querySelectorAll('[role="option"]').length > 0, 6000, 300);
    } catch (err) {
      // upload-only projects have no rows; fine
    }
    await this.delay(400);
    return plusBtn;
  },

  async closeOverlays() {
    for (let i = 0; i < 3; i++) {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) break;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await this.delay(400);
    }
  },

  /**
   * Probe: open the settings panel and dump everything inside (mode, ratio,
   * model family, outputs, and any video-specific groups like frames).
   */
  async probeSettingsPanel() {
    await this.openSettings();
    const dump = {
      buttons: this.visibleButtons()
        .filter((b) => {
          const t = (b.textContent || '') + (b.getAttribute('aria-label') || '');
          return /x\d|:|동영상|이미지|video|image|프레임|frame|모델|Veo|Nano|Imagen|Omni|crop|선택/i.test(t);
        })
        .map((b) => ({
          role: b.getAttribute('role'),
          aria: (b.getAttribute('aria-label') || '').slice(0, 60),
          text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
          checked: b.getAttribute('aria-checked')
        })),
      headings: Array.from(document.querySelectorAll('[role="group"], [class*="label"], [class*="heading"], legend, label'))
        .filter((t) => t.offsetParent !== null)
        .slice(0, 25)
        .map((t) => (t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50))
        .filter(Boolean)
    };
    await this.closeSettings();
    return dump;
  },

  /**
   * Probe: open the add menu, switch to the 업로드 tab, and dump everything
   * (looks for frame-upload options in video mode).
   */
  async probeUploadTab() {
    await this.openAddMenu();
    const uploadTab = Array.from(document.querySelectorAll('[role="tab"], mat-list-item')).find(
      (el) => el.offsetParent !== null && /^(업로드|upload)$/i.test((el.textContent || '').trim())
    );
    if (uploadTab) {
      uploadTab.click();
      await this.delay(1000);
    }
    const dump = {
      buttons: this.visibleButtons()
        .filter((b) => {
          const t = (b.textContent || '') + (b.getAttribute('aria-label') || '');
          return /업로드|upload|프레임|frame|파일|file|미디어/i.test(t);
        })
        .map((b) => ({
          role: b.getAttribute('role'),
          aria: (b.getAttribute('aria-label') || '').slice(0, 60),
          text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70)
        })),
      texts: Array.from(document.querySelectorAll('[class*="label"], [class*="title"], [class*="hint"], p, span'))
        .filter((t) => t.offsetParent !== null && /프레임|frame|시작|끝|first|last/i.test(t.textContent || ''))
        .slice(0, 10)
        .map((t) => (t.textContent || '').trim().slice(0, 80))
    };
    await this.closeOverlays();
    return dump;
  },

  /**
   * List the assets shown in the ingredient picker (uploads + generations)
   */
  async listAssets() {
    try {
      await this.openAddMenu();
    } catch (err) {
      // Frame mode replaces the + menu with frame slots — the start slot opens
      // the same asset picker.
      const chips = this.frameSlotButtons();
      const startChip =
        chips.find((b) => /시작|start/i.test(b.textContent) || b.querySelector('img')) || chips[0];
      if (!startChip) throw err;
      startChip.click();
      await this.delay(1100);
    }
    const options = Array.from(document.querySelectorAll('[role="option"]')).filter(
      (o) => o.offsetParent !== null
    );
    const assets = options.map((o, idx) => {
      const label = this.cleanLabel(o.textContent)
        .replace(/\s*-\d{2}-\d{2}T[\d-]+Z/g, (m) => m) // keep timestamps intact
        .replace(/(이미지|동영상|image|video)\s*$/i, '')
        .trim();
      return { index: idx + 1, label: label || `asset-${idx + 1}` };
    });
    await this.closeOverlays();
    return assets;
  },

  /**
   * Attach an existing project asset as an ingredient by label substring or
   * 1-based index (as returned by listAssets()).
   */
  async attachAssetAsIngredient(query) {
    await this.openAddMenu();
    const options = Array.from(document.querySelectorAll('[role="option"]')).filter(
      (o) => o.offsetParent !== null
    );
    if (options.length === 0) {
      await this.closeOverlays();
      throw new Error('The asset list is empty — upload or generate media first');
    }

    let target = null;
    if (/^\d+$/.test(String(query).trim())) {
      target = options[parseInt(query, 10) - 1];
    } else {
      const q = String(query).trim().toLowerCase();
      target = options.find((o) => (o.textContent || '').toLowerCase().includes(q));
    }
    if (!target) {
      await this.closeOverlays();
      throw new Error(`Asset not found in the picker: ${query}`);
    }

    const label = this.cleanLabel(target.textContent)
      .replace(/(이미지|동영상|image|video)\s*$/i, '')
      .trim();
    target.click();
    await this.delay(900);

    // Confirm with the "프롬프트에 추가" button if the picker requires it
    const addBtn = this.visibleButtons().find((b) =>
      /프롬프트에 추가|add to prompt/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || ''))
    );
    if (addBtn) {
      addBtn.click();
      await this.delay(1200);
    }
    await this.closeOverlays();

    const box = document.querySelector('flow-base-prompt-box');
    const chip =
      box &&
      (box.querySelector('img, [style*="background-image"]') ||
        Array.from(box.querySelectorAll('button')).find((b) =>
          /삭제|remove|지우기/i.test(b.getAttribute('aria-label') || '')
        ));
    return { attached: !!chip, asset: label };
  },

  /**
   * Probe: dump the add-menu structure while in the current mode (image/video).
   * Used to discover frame slots and other video-specific pickers.
   */
  async probeAddMenu() {
    await this.openAddMenu();
    const dump = {
      menus: Array.from(
        document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [role="menuitem"], [role="option"], [role="tab"], [role="tabpanel"], button')
      )
        .filter((m) => m.offsetParent !== null)
        .slice(0, 60)
        .map((m) => ({
          tag: m.tagName.toLowerCase(),
          role: m.getAttribute('role'),
          aria: (m.getAttribute('aria-label') || '').slice(0, 80),
          text: (m.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
        })),
      fileInputs: document.querySelectorAll('input[type="file"]').length
    };
    await this.closeOverlays();
    return dump;
  },

  /**
   * Remove ingredient chips from the prompt bar (used after uploading a frame
   * file through the + menu so it doesn't also act as an ingredient).
   * The chip's hover overlay holds a cancel icon; clicking it removes the chip.
   */
  async removeIngredientChips() {
    for (let round = 0; round < 8; round++) {
      const chips = document.querySelectorAll('flow-ingredient-chip button.chip-container');
      if (chips.length === 0) break;
      const chip = chips[chips.length - 1];
      const overlay = chip.querySelector('.hover-icon-overlay');
      const target = overlay || chip.querySelector('.mat-icon') || chip;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await this.delay(700);
    }
    const left = document.querySelectorAll('flow-ingredient-chip').length;
    return { removed: left === 0 };
  },

  /**
   * Frames-to-Video: select video mode + the "프레임" aspect option, then
   * expose the 시작/끝 frame slot buttons.
   */
  async selectFrameMode() {
    await this.switchMode('VIDEO');
    await this.delay(500);
    await this.openSettings();
    const target = this.panelRadios().find((r) => /프레임/.test(this.radioLabel(r) || ''));
    if (!target) {
      await this.closeSettings();
      throw new Error('"프레임" 옵션을 찾을 수 없습니다 (Veo 모델이 선택되어 있는지 확인하세요)');
    }
    const changed = target.getAttribute('aria-checked') !== 'true';
    if (changed) {
      target.click();
      await this.delay(900);
    }
    await this.closeSettings();
    await this.delay(400);
    return { frameMode: true, changed };
  },

  frameSlotButtons() {
    return Array.from(document.querySelectorAll('.frame-trigger button, [class*="frame-trigger"] button')).filter(
      (b) => b.offsetParent !== null
    );
  },

  /**
   * Open a frame slot (시작/끝) picker. With assetQuery, pick the asset from
   * the slot's picker; otherwise open the upload path and wait for the file
   * input so the background can inject the file.
   */
  async openFrameSlot(slot, assetQuery) {
    const isStart = slot !== 'end';
    // Slots render in order inside .frame-trigger containers; once filled, the
    // label text is replaced by a thumbnail, so fall back to positional match.
    const chips = this.frameSlotButtons();
    let slotBtn = isStart
      ? chips.find((b) => /시작|start/i.test(b.textContent)) || chips[0]
      : chips.find((b) => /종료|끝|end/i.test(b.textContent)) || (chips.length > 1 ? chips[1] : null);
    if (!slotBtn) {
      throw new Error(
        isStart ? '프레임 슬롯을 찾을 수 없습니다 (비디오 모드 + 프레임 옵션 확인)' : '종료 프레임 슬롯이 아직 없습니다 (시작 프레임을 먼저 추가하세요)'
      );
    }
    slotBtn.click();
    await this.delay(1100);

    if (assetQuery) {
      // The picker lazy-loads asset rows; wait for them before matching
      try {
        await this.waitForPredicate(
          () => document.querySelectorAll('[role="option"]').length > 0,
          8000,
          300
        );
      } catch (err) {
        /* upload-only projects have no rows */
      }
      const q = String(assetQuery).toLowerCase();
      let target = null;
      for (let attempt = 0; attempt < 3 && !target; attempt++) {
        const options = Array.from(document.querySelectorAll('[role="option"]')).filter(
          (o) => o.offsetParent !== null
        );
        target = /^\d+$/.test(String(assetQuery).trim())
          ? options[parseInt(assetQuery, 10) - 1]
          : options.find((o) => (o.textContent || '').toLowerCase().includes(q));
        if (!target) await this.delay(1200);
      }
      if (!target) {
        await this.closeOverlays();
        throw new Error(`프레임 자산을 찾을 수 없습니다: ${assetQuery}`);
      }
      target.click();
      await this.delay(900);
      const addBtn = this.visibleButtons().find((b) =>
        /프롬프트에 추가|add to prompt/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || ''))
      );
      if (addBtn) {
        addBtn.click();
        await this.delay(1200);
      }
      await this.closeOverlays();
      return { opened: true, via: 'asset', slot };
    }

    // Upload path: slot menu → 업로드 tab → 미디어 업로드 button → file input
    let input = document.querySelector('input[type="file"]');
    if (!input) {
      const uploadTab = Array.from(document.querySelectorAll('[role="tab"], mat-list-item')).find(
        (el) => el.offsetParent !== null && /^(업로드|upload)$/i.test((el.textContent || '').trim())
      );
      if (uploadTab) {
        uploadTab.click();
        await this.delay(800);
      }
      const uploadBtn = this.visibleButtons().find((b) =>
        /미디어 업로드|upload media/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || ''))
      );
      if (uploadBtn) {
        uploadBtn.click();
        await this.delay(1000);
      }
      input = await this.waitForPredicate(() => document.querySelector('input[type="file"]'), 8000, 250);
    }
    return { opened: true, via: 'upload', slot, fileInput: !!input };
  },

  /**
   * Wait until the given frame slot shows a filled thumbnail.
   */
  async waitFrameFilled(slot, timeoutMs = 30000) {
    const isStart = slot !== 'end';
    await this.waitForPredicate(() => {
      const chips = this.frameSlotButtons();
      const btn = isStart
        ? chips.find((b) => /시작|start/i.test(b.textContent) || b.querySelector('img'))
        : chips.find((b) => /종료|끝|end/i.test(b.textContent) || b.querySelector('img'));
      if (!btn) return false;
      // filled when the slot shows an image thumbnail
      return !!btn.querySelector('img, [style*="background-image"]');
    }, timeoutMs, 500);
    return { filled: true, slot };
  },

  /**
   * Find a clickable sidebar/nav element by its visible label (the nav uses
   * plain divs, not <button>, so query beyond buttons).
   */
  findNavElement(labelRe) {
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], [role="tab"], a, div[tabindex], li, mat-list-item, [class*="nav"] *')
    );
    return candidates.find((el) => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      // Match leaf-ish elements only (avoid giant ancestors that contain the label)
      if (!labelRe.test(t) || t.length > 25) return false;
      return true;
    });
  },

  /**
   * Probe: open the character sidebar tab and dump the panel structure.
   */
  async probeCharacters() {
    const tab = this.findNavElement(/^(캐릭터|characters?)$/i) || this.findNavElement(/캐릭터|characters?/i);
    if (!tab) throw new Error('Characters sidebar tab not found (open a project first)');
    tab.click();
    await this.delay(2000);

    const dump = {
      buttons: this.visibleButtons()
        .slice(0, 60)
        .map((b) => ({
          aria: (b.getAttribute('aria-label') || '').slice(0, 60),
          text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
        })),
      texts: Array.from(document.querySelectorAll('[class*="title"], h1, h2, h3, [class*="name"], [class*="card"], [class*="tile"]'))
        .filter((t) => t.offsetParent !== null)
        .slice(0, 30)
        .map((t) => ({ cls: (t.className || '').toString().slice(0, 40), text: (t.textContent || '').trim().slice(0, 60) }))
    };
    return dump;
  },

  /**
   * Probe: from the characters panel, open the create-character dialog
   * ("프로젝트에서 추가" = base it on an existing project asset) and dump fields.
   */
  async probeCharacterCreate() {
    // ensure characters tab open
    const tab = this.findNavElement(/^(캐릭터|characters?)$/i) || this.findNavElement(/캐릭터|characters?/i);
    if (!tab) throw new Error('Characters sidebar tab not found');
    tab.click();
    await this.delay(1500);

    const addBtn =
      this.visibleButtons().find((b) => /프로젝트에서 추가/i.test(b.textContent || '')) ||
      this.findNavElement(/프로젝트에서 추가/i);
    if (!addBtn) throw new Error('"프로젝트에서 추가" button not found');
    addBtn.click();
    await this.delay(2000);

    return this.dumpDialogFields();
  },

  /**
   * Dump all visible fields inside the topmost dialog (inputs, textareas,
   * contenteditables, buttons).
   */
  dumpDialogFields() {
    const dialog =
      Array.from(document.querySelectorAll('[role="dialog"], mat-dialog-container, .cdk-overlay-container [class*="dialog"]'))
        .filter((d) => d.offsetParent !== null)
        .pop() || document;

    const fields = Array.from(
      dialog.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')
    )
      .filter((el) => el.offsetParent !== null || el.isContentEditable)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        aria: (el.getAttribute('aria-label') || '').slice(0, 60),
        placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
        classes: (el.className || '').toString().slice(0, 60),
        value: (el.value || el.textContent || '').slice(0, 40)
      }));

    const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({
        aria: (b.getAttribute('aria-label') || '').slice(0, 60),
        text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true'
      }));

    const headings = Array.from(dialog.querySelectorAll('h1, h2, h3, [class*="title"], label'))
      .filter((t) => t.offsetParent !== null)
      .slice(0, 20)
      .map((t) => (t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60));

    return { fields, buttons, headings };
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

    if (options.tiles) {
      result.tiles = Array.from(document.querySelectorAll('img'))
        .filter((img) => img.naturalWidth > 100 || img.width > 100)
        .slice(0, 20)
        .map((img) => {
          let el = img.parentElement;
          let label = '';
          for (let d = 0; d < 6 && el; d++) {
            const t = (el.textContent || '').trim();
            if (t.length > 3 && t !== (img.alt || '')) {
              label = t.replace(/\s+/g, ' ').slice(0, 80);
              break;
            }
            el = el.parentElement;
          }
          return {
            src: (img.currentSrc || img.src || '').slice(0, 90),
            label
          };
        });
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

    if (options.promptBarHtml) {
      const editor = document.querySelector('div.ProseMirror[contenteditable="true"]');
      const levels = [];
      let node = editor && editor.closest('flow-rich-text-editor');
      for (let i = 0; node && i < 4; i++) {
        node = node.parentElement;
        if (node) levels.push(`<=== level ${i + 1} <${node.tagName.toLowerCase()} class="${node.className}">>\n${node.outerHTML.slice(0, 2500)}`);
      }
      result.promptBarHtml = levels.join('\n\n');
    }

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
