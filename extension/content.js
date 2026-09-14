/**
 * Google Flow CLI Extension - Content Script
 * Runs in the context of labs.google/fx/*
 */

(() => {
  if (window.__FLOW_CLI_CONTENT_LOADED__) return;
  window.__FLOW_CLI_CONTENT_LOADED__ = true;

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
            mediaCount: FlowActions.getMediaItems().length
          };
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
          const { prompt, model, ratio, duration, outputs, refs = [], confirm = false } = payload;

          // 1. Ensure project
          await FlowActions.ensureProject();
          await FlowActions.delay(1000);

          // 2. Video mode (switches the settings panel to video model families)
          await FlowActions.switchMode('VIDEO');
          await FlowActions.delay(500);

          // 3. Model & ratio & duration & outputs
          if (model) await FlowActions.selectModel(model);
          if (ratio) await FlowActions.selectRatio(ratio);
          if (duration) await FlowActions.selectDuration(duration);
          if (outputs) await FlowActions.selectOutputs(outputs);

          // 4. Attach references: existing assets first (in video mode an image
          // ingredient acts as the frame/reference), then file uploads
          const attachedRefs = [];
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

      case 'probe_characters':
        runAsync(async () => FlowActions.probeCharacters());
        return true;

      case 'probe_character_create':
        runAsync(async () => FlowActions.probeCharacterCreate());
        return true;

      case 'dump_dialog':
        runAsync(async () => FlowActions.dumpDialogFields());
        return true;

      case 'fetch_media':
        runAsync(async () => {
          const { src, uuid } = payload || {};
          if (!src && !uuid) throw new Error('fetch_media requires payload.src or payload.uuid');
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
