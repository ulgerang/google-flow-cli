/**
 * Google Flow CLI Extension - Content Script
 * Runs in the context of labs.google/fx/*
 */

(() => {
  if (window.__FLOW_CLI_CONTENT_LOADED__) return;
  window.__FLOW_CLI_CONTENT_LOADED__ = true;

  // DOM marker (visible from the page world) for debugging which build is live.
  document.documentElement.setAttribute('data-flow-cli', 'patched-2026-09-18');

  console.log('[Flow-CLI] Content script initialized on:', window.location.href);

  // Notify background script that Flow tab is ready
  try {
    chrome.runtime.sendMessage({
      type: 'FLOW_TAB_READY',
      url: window.location.href,
      title: document.title
    });
  } catch (e) {
    // Ignore if background not ready
  }

  // Handle messages from background service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action, payload, id } = request;

    // Async action runner helper
    const runAsync = async (fn) => {
      try {
        const result = await fn();
        sendResponse({ success: true, id, result });
      } catch (err) {
        console.error('[Flow-CLI] Action error:', err);
        sendResponse({
          success: false,
          id,
          error: err.message || 'Unknown error executing action'
        });
      }
    };

    switch (action) {
      case 'ping':
        sendResponse({
          success: true,
          id,
          result: {
            ready: true,
            url: window.location.href,
            title: document.title,
            inProject: window.location.href.includes('/project/')
          }
        });
        return true;

      case 'get_status':
        runAsync(async () => {
          const inProject = window.location.href.includes('/project/');
          const settings = FlowActions.readGenerationSettings
            ? await FlowActions.readGenerationSettings()
            : null;

          return {
            url: window.location.href,
            title: document.title,
            inProject,
            activeModel: settings?.model || 'Unknown',
            aspectRatio: settings?.ratio || null,
            outputs: settings?.outputs || null,
            mode: settings?.mode || null,
            promptInputAvailable: !!document.querySelector(
              'div.ProseMirror[contenteditable="true"], [contenteditable="true"], textarea'
            ),
            currentPrompt: (document.querySelector('div.ProseMirror[contenteditable="true"], [contenteditable="true"], textarea')?.innerText || '').slice(0, 100),
            generateBtnState: (() => {
              const b = FlowActions.visibleButtons().find((btn) => {
                const aria = btn.getAttribute('aria-label') || '';
                const text = (btn.textContent || '').trim();
                return /생성\s*시작|generate|créer|create/i.test(aria) || text.includes('arrow_forward');
              });
              return b ? { found: true, disabled: b.disabled || b.getAttribute('aria-disabled'), aria: b.getAttribute('aria-label') } : { found: false };
            })(),
            mediaCount: FlowActions.getMediaItems().length
          };
        });
        return true;

      case 'get_video_url':
        runAsync(async () => {
          const firstCard = document.querySelector('a[href*="/edit/"]') || document.querySelector('img[src*="/asb/"]');
          if (!firstCard) throw new Error('No media card found');
          firstCard.click();
          await FlowActions.delay(2000);

          const video = document.querySelector('video');
          const videoSrc = video ? (video.currentSrc || video.src) : null;
          const downloadBtn = FlowActions.visibleButtons().find((b) =>
            /다운로드|download/i.test(b.getAttribute('aria-label') || b.textContent)
          );

          return {
            editUrl: window.location.href,
            videoSrc,
            hasDownloadBtn: !!downloadBtn,
            allVideos: Array.from(document.querySelectorAll('video')).map((v) => v.currentSrc || v.src)
          };
        });
        return true;

      case 'click_download':
        runAsync(async () => {
          const downloadBtn = FlowActions.visibleButtons().find((b) =>
            /다운로드|download/i.test(b.getAttribute('aria-label') || b.textContent)
          );
          if (!downloadBtn) throw new Error('Download button not found');
          const info = {
            tag: downloadBtn.tagName,
            href: downloadBtn.getAttribute('href') || downloadBtn.href,
            aria: downloadBtn.getAttribute('aria-label'),
            text: downloadBtn.textContent.trim()
          };
          downloadBtn.click();
          return { clicked: true, btn: info };
        });
        return true;

      case 'inspect_flow_ui':
        runAsync(async () => {
          await FlowActions.openSettings().catch(() => null);
          const radios = FlowActions.panelRadios().map((r) => ({
            text: (r.textContent || '').trim(),
            aria: r.getAttribute('aria-label'),
            checked: r.getAttribute('aria-checked')
          }));
          const buttons = FlowActions.visibleButtons().map((b) => ({
            text: (b.textContent || '').trim(),
            aria: b.getAttribute('aria-label'),
            disabled: b.disabled || b.getAttribute('aria-disabled')
          }));
          await FlowActions.closeSettings().catch(() => null);
          return { radios, buttons: buttons.slice(0, 25), url: window.location.href };
        });
        return true;

      case 'search_buttons':
        runAsync(async () => {
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a')).map((b) => ({
            tag: b.tagName,
            text: (b.textContent || '').trim().replace(/\s+/g, ' '),
            aria: b.getAttribute('aria-label') || '',
            href: b.getAttribute('href') || ''
          }));
          return {
            matching: allButtons.filter((b) =>
              /동영상|비디오|영상|video|animate|재생|play|generate|생성/i.test(b.text + ' ' + b.aria)
            ),
            url: window.location.href
          };
        });
        return true;

      case 'play_and_get_video':
        runAsync(async () => {
          const playBtn = FlowActions.visibleButtons().find((b) =>
            /재생|play_arrow/i.test(b.getAttribute('aria-label') || b.textContent)
          );
          if (playBtn) playBtn.click();
          await FlowActions.delay(1000);
          const video = document.querySelector('video');
          return {
            hasVideo: !!video,
            src: video ? video.currentSrc || video.src : null,
            paused: video ? video.paused : null
          };
        });
        return true;

      case 'inspect_download_menu':
        runAsync(async () => {
          const downloadBtn = FlowActions.visibleButtons().find((b) =>
            /미디어 다운로드|다운로드|download/i.test(b.getAttribute('aria-label') || b.textContent)
          );
          if (downloadBtn) downloadBtn.click();
          await FlowActions.delay(800);
          const menuItems = Array.from(
            document.querySelectorAll('[role="menuitem"], [role="option"], [role="menu"] *, [class*="menu"] *')
          )
            .filter((el) => el.offsetParent !== null && el.textContent.trim().length > 0)
            .map((el) => ({
              tag: el.tagName,
              text: (el.textContent || '').trim().replace(/\s+/g, ' '),
              aria: el.getAttribute('aria-label')
            }));
          return { menuItems: menuItems.slice(0, 20) };
        });
        return true;

      case 'download_720p_video':
        runAsync(async () => {
          let interceptedUrl = null;

          const origAnchorClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            interceptedUrl = this.href;
            return origAnchorClick.apply(this, arguments);
          };

          const origOpen = window.open;
          window.open = function (url) {
            interceptedUrl = url;
            return origOpen.apply(this, arguments);
          };

          const downloadBtn = FlowActions.visibleButtons().find((b) =>
            /미디어 다운로드|다운로드|download/i.test(b.getAttribute('aria-label') || b.textContent)
          );
          if (downloadBtn) downloadBtn.click();
          await FlowActions.delay(800);

          const items = Array.from(document.querySelectorAll('button, [role="menuitem"], flow-menu-item')).filter(
            (el) => el.offsetParent !== null && /720p/i.test(el.textContent)
          );
          const target = items[0];
          if (!target) {
            HTMLAnchorElement.prototype.click = origAnchorClick;
            window.open = origOpen;
            throw new Error('720p download option not found in menu');
          }
          target.click();

          for (let i = 0; i < 12; i++) {
            if (interceptedUrl) break;
            await FlowActions.delay(500);
          }

          HTMLAnchorElement.prototype.click = origAnchorClick;
          window.open = origOpen;

          return { interceptedUrl, targetText: target.textContent.trim() };
        });
        return true;

      case 'ensure_project':
        runAsync(async () => {
          return await FlowActions.ensureProject(payload?.projectName);
        });
        return true;

      case 'generate_image':
        runAsync(async () => {
          const { prompt, model, ratio, outputs, refs = [], assets = [], dryRun, timeoutMs = 180000 } = payload;

          // 1. Ensure project context
          await FlowActions.ensureProject();
          await FlowActions.delay(1000);

          // 2. Image mode (model family follows the mode radio in the settings panel)
          await FlowActions.switchMode('IMAGE');
          await FlowActions.delay(500);

          // 3. Model / ratio / outputs via the settings panel
          if (model) await FlowActions.selectModel(model);
          if (ratio) await FlowActions.selectRatio(ratio);
          if (outputs) await FlowActions.selectOutputs(outputs);

          // 4. Baseline BEFORE attaching references — the ingredient upload also
          // creates a new project tile which must not be mistaken for output
          const initialKeys = FlowActions.getMediaItems().map((i) => i.src);

          // 5. Attach references: existing assets first (fast), then file uploads
          const attachedRefs = [];
          for (const assetQuery of assets) {
            try {
              const r = await FlowActions.attachAssetAsIngredient(assetQuery);
              attachedRefs.push(r.asset || String(assetQuery));
            } catch (aErr) {
              console.warn('[Flow-CLI] Asset attach failed:', assetQuery, aErr.message);
              attachedRefs.push({ asset: assetQuery, error: aErr.message });
            }
          }
          for (const ref of refs) {
            try {
              const r = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                  { type: 'BG_ATTACH_REF', payload: { filePath: ref.path } },
                  (resp) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (resp && resp.error) reject(new Error(resp.error));
                    else resolve(resp);
                  }
                );
              });
              attachedRefs.push(ref.name || 'reference');
            } catch (refErr) {
              console.warn('[Flow-CLI] Reference attach failed:', ref.name, refErr.message);
              attachedRefs.push({ name: ref.name, error: refErr.message });
            }
          }

          // The uploaded ingredient's own tile renders asynchronously; wait until
          // the media tile set is stable (two identical consecutive scans) and
          // fold everything into the baseline so only real output counts as new.
          if (refs.length || assets.length) {
            let lastKeys = null;
            const t0 = Date.now();
            while (Date.now() - t0 < 40000) {
              await FlowActions.delay(2500);
              const keys = FlowActions.getMediaItems().map((i) => i.src);
              keys.forEach((k) => {
                if (!initialKeys.includes(k)) initialKeys.push(k);
              });
              if (
                lastKeys &&
                keys.length === lastKeys.length &&
                keys.every((k) => lastKeys.includes(k))
              ) {
                break;
              }
              lastKeys = keys;
            }
          }

          // 6. Fill prompt
          await FlowActions.fillPrompt(prompt);

          // 7. Dry run check
          if (dryRun) {
            const settings = await FlowActions.readGenerationSettings();
            return {
              dryRun: true,
              status: 'ready_for_confirmation',
              message: 'Prompt, model, and settings prepared. Ready to generate.',
              prompt,
              model,
              ratio,
              outputs,
              refs: attachedRefs,
              activeSettings: settings
            };
          }

          // 8. Trigger generation
          await FlowActions.triggerGenerate();

          // 9. Wait for new media to appear. With references attached, prefer
          // label-based detection: Flow titles output tiles after the prompt,
          // while the uploaded reference tile keeps the file name (src-based
          // detection alone mistakes the uploaded ingredient for the output).
          let genResult;
          if (refs.length) {
            const genStart = Date.now();
            genResult = await FlowActions.waitForPredicate(() => {
              const found = FlowActions.findGeneratedTiles(prompt, initialKeys);
              if (found.length > 0) {
                return {
                  success: true,
                  items: found,
                  allItems: FlowActions.getMediaItems(),
                  elapsedMs: Date.now() - genStart
                };
              }
              return false;
            }, timeoutMs, 2500);
            chrome.runtime.sendMessage({ type: 'JOB_PROGRESS', id, progress: { status: 'generating' } }).catch(() => {});
          } else {
            genResult = await FlowActions.waitForGeneration({
              initialKeys,
              timeoutMs,
              onProgress: (progress) => {
                chrome.runtime.sendMessage({
                  type: 'JOB_PROGRESS',
                  id,
                  progress
                });
              }
            });
          }

          // 10. Fetch media blobs as Base64 for CLI saving (small delay lets the
          // freshly created tiles finish signing/serving their URLs)
          await FlowActions.delay(2000);
          const media = [];
          for (const item of genResult.items) {
            let fetched = null;
            for (let attempt = 0; attempt < 3 && !fetched; attempt++) {
              try {
                fetched = await FlowActions.fetchMediaDataUrl(item);
              } catch (fetchErr) {
                console.warn('[Flow-CLI] Media fetch attempt failed:', fetchErr.message);
                // Re-read the tile: the signed URL may have been refreshed.
                const fresh = FlowActions.getMediaItems().find((i) => i.uuid === item.uuid || i.src === item.src);
                if (fresh && fresh.src !== item.src) item.src = fresh.src;
                await FlowActions.delay(2500);
              }
            }
            if (fetched) {
              media.push(fetched);
            } else {
              media.push({ src: item.src, uuid: item.uuid });
            }
          }

          return {
            status: 'success',
            prompt,
            model,
            ratio,
            outputs,
            refs: attachedRefs,
            elapsedMs: genResult.elapsedMs,
            media,
            mediaCount: media.length
          };
        });
        return true;

      case 'generate_video':
        runAsync(async () => {
          const {
            prompt,
            model,
            ratio,
            duration,
            outputs,
            refs = [],
            assets = [],
            frames,
            confirm = false
          } = payload;

          // 1. Ensure project
          await FlowActions.ensureProject();
          await FlowActions.delay(1000);

          // 2. Video mode (switches the settings panel to video model families)
          await FlowActions.switchMode('VIDEO');
          await FlowActions.delay(500);

          // 2b. Frames-to-Video: when start/end frames are given, switch the
          // aspect to "프레임" so the prompt bar exposes 시작/끝 frame slots.
          const frameSpecs = [];
          if (frames) {
            if (frames.start) frameSpecs.push({ slot: 'start', ...frames.start });
            if (frames.end) frameSpecs.push({ slot: 'end', ...frames.end });
          }

          // 3. Model & ratio & duration & outputs
          if (model) await FlowActions.selectModel(model).catch(() => null);
          if (!frames && ratio) await FlowActions.selectRatio(ratio).catch(() => null);
          if (duration) await FlowActions.selectDuration(duration).catch(() => null);
          if (outputs) await FlowActions.selectOutputs(outputs).catch(() => null);
          await FlowActions.closeSettings().catch(() => null);

          // 3b. Fill frame slots (시작 → 종료). Local files are staged as
          // PROJECT assets through the top-bar upload (attaches nothing to the
          // prompt bar), then each slot picks the staged asset by file name.
          const attachedFrames = [];
          if (frameSpecs.length) {
            for (const spec of frameSpecs.filter((s) => s.type === 'file')) {
              try {
                await new Promise((resolve, reject) => {
                  chrome.runtime.sendMessage(
                    { type: 'BG_STAGE_FRAME_FILE', payload: { filePath: spec.path } },
                    (resp) => {
                      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                      else if (resp && resp.error) reject(new Error(resp.error));
                      else resolve(resp);
                    }
                  );
                });
              } catch (stageErr) {
                throw new Error('프레임 파일 스테이징 실패: ' + stageErr.message);
              }
              // Close the media menu that remains open after the intercepted upload
              await FlowActions.closeOverlays();
              await FlowActions.delay(800);
              await FlowActions.waitAssetByName(spec.name, 30000).catch(() => null);
              spec.query = spec.name;
              spec.type = 'asset';
            }
            await FlowActions.selectFrameMode();
            for (const spec of frameSpecs) {
              try {
                await FlowActions.openFrameSlot(spec.slot, spec.query);
                await FlowActions.waitFrameFilled(spec.slot, 30000).catch(() => null);
                attachedFrames.push(spec.slot);
              } catch (fErr) {
                console.warn('[Flow-CLI] Frame attach failed:', spec.slot, fErr.message);
                attachedFrames.push({ slot: spec.slot, error: fErr.message });
              }
            }
          }

          // 4. Attach references (ingredient path — skipped in frame mode where
          // the + menu is replaced by frame slots): existing assets first, then
          // file uploads
          const attachedRefs = [];
          if (!frameSpecs.length) {
            for (const assetQuery of assets) {
              try {
                const r = await FlowActions.attachAssetAsIngredient(assetQuery);
                attachedRefs.push(r.asset || String(assetQuery));
              } catch (aErr) {
                attachedRefs.push({ asset: assetQuery, error: aErr.message });
              }
            }
            for (const ref of refs) {
              try {
                await new Promise((resolve, reject) => {
                  chrome.runtime.sendMessage(
                    { type: 'BG_ATTACH_REF', payload: { filePath: ref.path } },
                    (resp) => {
                      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                      else if (resp && resp.error) reject(new Error(resp.error));
                      else resolve(resp);
                    }
                  );
                });
                attachedRefs.push(ref.name || 'reference');
              } catch (refErr) {
                attachedRefs.push({ name: ref.name, error: refErr.message });
              }
            }
          }

          // 5. Fill prompt
          await FlowActions.fillPrompt(prompt);

          // Video uses credits - require explicit confirmation
          if (!confirm) {
            const settings = await FlowActions.readGenerationSettings();
            return {
              status: 'ready_for_confirmation',
              message: 'Video prompt and settings prepared. Pass --confirm to execute generation.',
              prompt,
              model,
              ratio,
              duration,
              outputs,
              refs: attachedRefs,
              frames: attachedFrames,
              activeSettings: settings
            };
          }

          const initialKeys = FlowActions.getMediaItems().map((i) => i.src);
          await FlowActions.triggerGenerate();

          return {
            status: 'started',
            message: 'Video generation triggered in Google Flow.',
            prompt,
            model,
            ratio,
            duration,
            outputs,
            initialMediaCount: initialKeys.length
          };
        });
        return true;

      case 'list_characters':
        runAsync(async () => {
          return await FlowActions.listCharactersFromPage();
        });
        return true;

      case 'create_character':
        runAsync(async () => {
          const { description, preset, timeoutMs } = payload || {};
          return await FlowActions.createCharacter(description, preset, timeoutMs);
        });
        return true;

      case 'delete_character':
        runAsync(async () => {
          const { name } = payload || {};
          if (!name) throw new Error('delete_character requires payload.name');
          return await FlowActions.deleteCharacter(name);
        });
        return true;

      case 'rename_character':
        runAsync(async () => {
          const { name, newName, personality } = payload || {};
          if (!name || (!newName && !personality)) {
            throw new Error('rename_character requires payload.name and (newName or personality)');
          }
          return await FlowActions.renameCharacter(name, newName, personality);
        });
        return true;

      case 'open_character_detail':
        runAsync(async () => {
          const { name } = payload || {};
          if (!name) throw new Error('open_character_detail requires payload.name');
          return await FlowActions.openCharacterDetail(name);
        });
        return true;

      case 'list_media':
        runAsync(async () => {
          const items = FlowActions.getMediaItems();
          return {
            inProject: window.location.href.includes('/project/'),
            url: window.location.href,
            mediaCount: items.length,
            items
          };
        });
        return true;

      case 'add_ingredient':
        runAsync(async () => {
          const { dataUrl, name } = payload || {};
          if (!dataUrl) throw new Error('add_ingredient requires payload.dataUrl');
          return await FlowActions.addIngredientFromDataUrl(dataUrl, name);
        });
        return true;

      case 'open_upload_picker':
        runAsync(async () => {
          // Reveal Flow's hidden file input with the fewest invasive clicks.
          // Each stage stops early once an input[type=file] is mounted.
          const findInput = () => document.querySelector('input[type="file"]');
          let input = findInput();
          if (input) return { fileInput: true, via: 'existing' };

          const plusBtn = FlowActions.visibleButtons().find((b) =>
            /소재 추가|ingredient|프롬프트 상자에/i.test(b.getAttribute('aria-label') || '')
          );
          if (plusBtn) {
            plusBtn.click();
            await FlowActions.delay(900);
            input = findInput();
            if (input) return { fileInput: true, via: 'after_menu' };
          }

          // Switch to the upload view (tab click usually just mounts the input)
          const uploadTab = Array.from(
            document.querySelectorAll('[role="tab"], mat-list-item')
          ).find(
            (el) =>
              el.offsetParent !== null &&
              /^(업로드|upload)$/i.test((el.textContent || '').trim())
          );
          if (uploadTab) {
            uploadTab.click();
            await FlowActions.delay(700);
            input = findInput();
            if (input) return { fileInput: true, via: 'after_upload_tab' };
          }

          // Last resort: the explicit upload button (may open a native dialog)
          const uploadBtn = Array.from(document.querySelectorAll('button')).find(
            (el) =>
              el.offsetParent !== null &&
              /(미디어 업로드|upload media|upload)/i.test(
                (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')
              )
          );
          if (uploadBtn) {
            uploadBtn.click();
            await FlowActions.delay(900);
            input = findInput();
            if (input) return { fileInput: true, via: 'after_upload_button' };
          }

          return { fileInput: false };
        });
        return true;

      case 'wait_ingredient_attached':
        runAsync(async () => {
          // After the file is injected, Flow shows it pre-selected in the asset
          // picker with an "프롬프트에 추가" (Add to prompt) button. Click it,
          // wait for the picker to close, then look for the ingredient chip in
          // the prompt box.
          const timeoutMs = payload?.timeoutMs || 20000;
          let clicked = false;
          try {
            const addBtn = await FlowActions.waitForPredicate(
              () =>
                FlowActions.visibleButtons().find((b) =>
                  /프롬프트에 추가|add to prompt/i.test(
                    (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')
                  )
                ) || false,
              Math.min(timeoutMs, 12000),
              400
            );
            if (addBtn) {
              addBtn.click();
              clicked = true;
              await FlowActions.delay(1500);
            }
          } catch (e) {
            // No add button (some flows attach directly) — fall through
          }

          let chipVisible = false;
          try {
            await FlowActions.waitForPredicate(() => {
              const box = document.querySelector('flow-base-prompt-box');
              if (!box) return false;
              const hit =
                box.querySelectorAll('img, [style*="background-image"]').length > 0 ||
                !!Array.from(box.querySelectorAll('button')).find((b) =>
                  /삭제|remove|지우기/i.test(b.getAttribute('aria-label') || '')
                );
              return hit;
            }, 8000, 400);
            chipVisible = true;
          } catch (e) {
            // chip heuristics can miss; the picker close state decides below
          }

          const dialogGone = !document.querySelector('[role="dialog"]');
          return { attached: clicked || chipVisible || dialogGone, clicked, chipVisible, dialogGone };
        });
        return true;

      case 'close_ingredient_panel':
        runAsync(async () => {
          // Close the still-open asset picker dialog (닫기 / close buttons first,
          // then an Escape keydown as fallback).
          const closeBtn = Array.from(document.querySelectorAll('button')).find(
            (b) =>
              b.offsetParent !== null &&
              /^(닫기|close)$/i.test((b.textContent || '').trim()) &&
              b.closest('[role="dialog"], [class*="dialog"], [class*="panel"], [class*="popover"]')
          );
          if (closeBtn) {
            closeBtn.click();
            await FlowActions.delay(500);
          }
          if (document.querySelector('[role="dialog"]')) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await FlowActions.delay(400);
          }
          return { closed: !document.querySelector('[role="dialog"]') };
        });
        return true;

      case 'list_assets':
        runAsync(async () => FlowActions.listAssets());
        return true;

      case 'attach_asset':
        runAsync(async () => {
          const { query } = payload || {};
          if (query === undefined) throw new Error('attach_asset requires payload.query (label substring or 1-based index)');
          return await FlowActions.attachAssetAsIngredient(query);
        });
        return true;

      case 'probe_add_menu':
        runAsync(async () => FlowActions.probeAddMenu());
        return true;

      case 'probe_settings_video':
        runAsync(async () => {
          await FlowActions.switchMode('VIDEO');
          await FlowActions.delay(600);
          return await FlowActions.probeSettingsPanel();
        });
        return true;

      case 'probe_upload_tab':
        runAsync(async () => {
          await FlowActions.switchMode('VIDEO');
          await FlowActions.delay(600);
          return await FlowActions.probeUploadTab();
        });
        return true;

      case 'select_settings_radio':
        runAsync(async () => {
          const { label, mode } = payload || {};
          if (!label) throw new Error('select_settings_radio requires payload.label');
          // mode: 'VIDEO'/'IMAGE' switches mode first when needed
          if (mode) await FlowActions.switchMode(mode);
          const r = await (async () => {
            await FlowActions.openSettings();
            const target = FlowActions.panelRadios().find((radio) => {
              const lab = (FlowActions.radioLabel(radio) || '').replace(/\s+/g, '');
              return lab.includes(String(label).replace(/\s+/g, ''));
            });
            if (!target) return { selected: false, label };
            const changed = target.getAttribute('aria-checked') !== 'true';
            if (changed) {
              target.click();
              await FlowActions.delay(700);
            }
            await FlowActions.closeSettings();
            return { selected: true, changed, label };
          })();
          return r;
        });
        return true;

      case 'probe_ingredient_chip':
        runAsync(async () => {
          const chip = document.querySelector('flow-ingredient-chip button.chip-container, button.chip-container[aria-label="소재"]');
          if (!chip || chip.offsetParent === null) throw new Error('ingredient chip not found');
          chip.click();
          await FlowActions.delay(1200);
          const dump = FlowActions.dumpDialogFields();
          await FlowActions.closeOverlays();
          return dump;
        });
        return true;

      case 'probe_characters':
        runAsync(async () => FlowActions.probeCharacters());
        return true;

      case 'probe_character_create':
        runAsync(async () => FlowActions.probeCharacterCreate());
        return true;

      case 'dump_dialog':
        runAsync(async () => FlowActions.dumpDialogFields());
        return true;

      case 'open_project_upload':
        runAsync(async () => FlowActions.openProjectUpload());
        return true;

      case 'click_media_upload_entry':
        runAsync(async () => {
          // Click the top-bar 미디어 메뉴 추가, then its 업로드 entry. The file
          // chooser is intercepted by the background (Page.fileChooserRequested).
          const addBtn = FlowActions.visibleButtons().find((b) =>
            /미디어 메뉴 추가|add media/i.test(b.getAttribute('aria-label') || '')
          );
          if (!addBtn) throw new Error('프로젝트 미디어 추가 버튼을 찾을 수 없습니다');
          addBtn.click();
          await FlowActions.delay(1000);
          // The menu also contains a LEFT-NAV CATEGORY whose label is just
          // "업로드" (rendered as "drive_folder_upload 업로드"). Clicking that
          // only switches the library tab and never opens a file chooser, so a
          // loose /업로드/ match silently picks the wrong element. Require the
          // full "미디어 업로드" label, and use getClientRects() because the real
          // button sits in a fixed overlay where offsetParent is null.
          const onScreen = (el) => el.getClientRects().length > 0;
          const label = (el) =>
            ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''))
              .replace(/\s+/g, ' ')
              .trim();
          const candidates = Array.from(
            document.querySelectorAll('button, [role="button"], [role="menuitem"], mat-list-item')
          ).filter(onScreen);
          const entry =
            candidates.find((el) => /미디어 업로드|upload media/i.test(label(el))) ||
            candidates.find(
              (el) => /업로드|upload/i.test(label(el)) && !/drive_folder_upload/i.test(label(el))
            );
          if (!entry) throw new Error('업로드 항목을 찾을 수 없습니다');
          entry.click();
          await FlowActions.delay(500);
          return { clicked: true };
        });
        return true;

      case 'probe_media_menu':
        runAsync(async () => FlowActions.probeMediaMenu());
        return true;

      case 'wait_asset_by_name':
        runAsync(async () => {
          const { fileName, timeoutMs = 30000 } = payload || {};
          if (!fileName) throw new Error('wait_asset_by_name requires payload.fileName');
          return await FlowActions.waitAssetByName(fileName, timeoutMs);
        });
        return true;

      case 'select_frame_slot':
        runAsync(async () => {
          const { slot = 'start', assetQuery } = payload || {};
          await FlowActions.selectFrameMode();
          return await FlowActions.openFrameSlot(slot, assetQuery);
        });
        return true;

      case 'wait_frame_filled':
        runAsync(async () => {
          const { slot = 'start', timeoutMs = 30000 } = payload || {};
          return await FlowActions.waitFrameFilled(slot, timeoutMs);
        });
        return true;

      case 'fetch_media':
        runAsync(async () => {
          let { src, uuid } = payload || {};
          if (!src && !uuid) throw new Error('fetch_media requires payload.src or payload.uuid');
          // A bare UUID makes the background construct an unsigned
          // flow-content.google URL, which the CDN rejects with 401. Resolve
          // the tile's currently signed src from the page first.
          if (!src && uuid) {
            const item = FlowActions.getMediaItems().find((i) => i.uuid === uuid);
            if (item && item.src) src = item.src;
          }
          return await FlowActions.fetchMediaDataUrl({ src, uuid });
        });
        return true;

      case 'list_projects':
        runAsync(async () => {
          const projects = FlowActions.listProjectsFromPage();
          if (projects.length === 0 && window.location.href.includes('/project/')) {
            return {
              homeRequired: true,
              message: 'The open tab is inside a project. Open the Flow homepage (https://flow.google.com/) to scan all projects.'
            };
          }
          return projects;
        });
        return true;

      case 'debug_dom':
        runAsync(async () => {
          return FlowActions.inspectDom(payload?.options || {});
        });
        return true;

      default:
        sendResponse({ success: false, id, error: `Unknown action: ${action}` });
        return false;
    }
  });
})();
