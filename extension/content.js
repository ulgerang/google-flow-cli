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
          const buttons = Array.from(document.querySelectorAll('button'));
          const modelBtn = buttons.find((b) => {
            const t = b.textContent || '';
            return (
              (t.includes('Nano') ||
                t.includes('Banana') ||
                t.includes('Imagen') ||
                t.includes('Veo') ||
                t.includes('Omni')) &&
              b.offsetParent !== null
            );
          });

          return {
            url: window.location.href,
            title: document.title,
            inProject,
            activeModel: modelBtn ? modelBtn.textContent.trim().replace(/\s+/g, ' ') : 'Unknown',
            promptInputAvailable: !!document.querySelector('[contenteditable="true"], textarea'),
            mediaCount: FlowActions.getMediaUuids().length
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
          const { prompt, model, ratio, dryRun, timeoutMs = 180000 } = payload;

          // 1. Ensure project context
          await FlowActions.ensureProject();
          await FlowActions.delay(1000);

          // 2. Switch to Image mode
          await FlowActions.switchMode('IMAGE');
          await FlowActions.delay(500);

          // 3. Select model if requested
          if (model) {
            await FlowActions.selectModel(model);
          }

          // 4. Select aspect ratio if requested
          if (ratio) {
            await FlowActions.selectRatio(ratio);
          }

          // 5. Fill prompt
          await FlowActions.fillPrompt(prompt);

          // 6. Dry run check
          if (dryRun) {
            return {
              dryRun: true,
              status: 'ready_for_confirmation',
              message: 'Prompt, model, and ratio prepared. Ready to generate.',
              prompt,
              model,
              ratio
            };
          }

          // 7. Get baseline image UUIDs before clicking generate
          const initialUuids = FlowActions.getMediaUuids();

          // 8. Trigger generation
          await FlowActions.triggerGenerate();

          // 9. Wait for new images to appear
          const genResult = await FlowActions.waitForGeneration({
            initialUuids,
            timeoutMs,
            onProgress: (progress) => {
              chrome.runtime.sendMessage({
                type: 'JOB_PROGRESS',
                id,
                progress
              });
            }
          });

          // 10. Fetch media blobs as Base64 for CLI saving
          const media = [];
          for (const uuid of genResult.uuids) {
            try {
              const fileData = await FlowActions.fetchMediaDataUrl(uuid);
              media.push(fileData);
            } catch (fetchErr) {
              console.warn('[Flow-CLI] Could not fetch media DataURL for UUID:', uuid, fetchErr);
              media.push({
                uuid,
                url: `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`
              });
            }
          }

          return {
            status: 'success',
            prompt,
            model,
            ratio,
            elapsedMs: genResult.elapsedMs,
            media,
            mediaCount: media.length
          };
        });
        return true;

      case 'generate_video':
        runAsync(async () => {
          const { prompt, model, ratio, duration, confirm = false } = payload;

          // 1. Ensure project
          await FlowActions.ensureProject();
          await FlowActions.delay(1000);

          // 2. Switch to Video mode
          await FlowActions.switchMode('VIDEO');
          await FlowActions.delay(500);

          // 3. Model & ratio & duration
          if (model) await FlowActions.selectModel(model);
          if (ratio) await FlowActions.selectRatio(ratio);
          if (duration) await FlowActions.selectDuration(duration);

          // 4. Fill prompt
          await FlowActions.fillPrompt(prompt);

          // Video uses credits - require explicit confirmation
          if (!confirm) {
            return {
              status: 'ready_for_confirmation',
              message: 'Video prompt and settings prepared. Pass --confirm to execute generation.',
              prompt,
              model,
              ratio,
              duration
            };
          }

          await FlowActions.triggerGenerate();

          return {
            status: 'started',
            message: 'Video generation triggered in Google Flow.',
            prompt,
            model,
            ratio,
            duration
          };
        });
        return true;

      case 'list_projects':
        runAsync(async () => {
          return FlowActions.listProjectsFromPage();
        });
        return true;

      default:
        sendResponse({ success: false, id, error: `Unknown action: ${action}` });
        return false;
    }
  });
})();
