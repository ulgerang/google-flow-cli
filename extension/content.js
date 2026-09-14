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
          const { prompt, model, ratio, outputs, dryRun, timeoutMs = 180000 } = payload;

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

          // 4. Fill prompt
          await FlowActions.fillPrompt(prompt);

          // 5. Dry run check
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
              activeSettings: settings
            };
          }

          // 6. Get baseline media keys before clicking generate
          const initialKeys = FlowActions.getMediaItems().map((i) => i.src);

          // 7. Trigger generation
          await FlowActions.triggerGenerate();

          // 8. Wait for new media to appear
          const genResult = await FlowActions.waitForGeneration({
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

          // 9. Fetch media blobs as Base64 for CLI saving (small delay lets the
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
            elapsedMs: genResult.elapsedMs,
            media,
            mediaCount: media.length
          };
        });
        return true;

      case 'generate_video':
        runAsync(async () => {
          const { prompt, model, ratio, duration, outputs, confirm = false } = payload;

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

          // 4. Fill prompt
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
