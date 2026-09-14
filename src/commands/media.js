import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';
import { saveMediaItem } from '../utils/file-saver.js';

/**
 * flow media list            - list media UUIDs detected in the open project
 * flow media latest [n]      - download the n most recent items (default 1)
 * flow media get <uuid>      - download a specific media UUID
 */
export async function handleMedia(subcommand = 'list', arg = null, options = {}) {
  const client = new BridgeClient(options);
  const outputDir = path.resolve(options.output || './flow_output');

  try {
    if (subcommand === 'list') {
      const spinner = ora('Scanning media in the open Flow project...').start();
      const result = await client.execute(
        'list_media',
        {},
        {
          timeoutMs: 15000,
          onStatusUpdate: (msg) => {
            spinner.text = msg;
          }
        }
      );

      if (!result.inProject) {
        spinner.info(chalk.yellow('Not inside a project. Open a project first (`flow open`).'));
        return;
      }

      spinner.succeed(
        chalk.green(`${result.mediaCount} media item(s) visible in the current project view.`)
      );
      (result.items || []).forEach((item, i) => {
        console.log(`  ${chalk.bold.cyan(`[${i + 1}]`)} ${item.uuid || '(opaque)'} ${chalk.gray(item.src.slice(0, 80))}`);
      });
      console.log(chalk.gray('\nDownload with: flow media latest [count]'));
      return;
    }

    if (subcommand === 'latest' || subcommand === 'get') {
      let items = [];
      const spinner = ora('Locating media...').start();

      if (subcommand === 'get') {
        if (!arg) {
          spinner.fail(chalk.red('Usage: flow media get <uuid-or-src>'));
          return;
        }
        items = arg.startsWith('http') ? [{ src: arg }] : [{ uuid: arg }];
      } else {
        const count = Math.max(1, parseInt(arg, 10) || 1);
        const result = await client.execute('list_media', {}, { timeoutMs: 15000 });
        // The project grid shows the newest media first (top-left), so "latest"
        // takes items from the head of the list.
        items = (result.items || []).slice(0, count);
        if (items.length === 0) {
          spinner.info(chalk.yellow('No media detected in the current project view.'));
          return;
        }
      }

      spinner.text = `Downloading ${items.length} media item(s)...`;
      let saved = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const media = await client.execute('fetch_media', { src: item.src, uuid: item.uuid }, { timeoutMs: 60000 });
          if (media.dataUrl) {
            const file = await saveMediaItem({
              outputDir,
              type: (media.mimeType || '').startsWith('video/') ? 'video' : 'image',
              data: media.dataUrl,
              metadata: { src: item.src, uuid: item.uuid, mimeType: media.mimeType, source: 'google-flow-media-command' }
            });
            saved++;
            console.log(
              `  ${chalk.green('✔')} [${i + 1}/${items.length}] ${chalk.bold.underline(file.filePath)} (${(file.size / 1024).toFixed(1)} KB)`
            );
          } else {
            console.log(`  ${chalk.blue('🔗')} [${i + 1}/${items.length}] ${item.src || item.uuid}`);
          }
        } catch (err) {
          console.log(`  ${chalk.red('✖')} [${i + 1}/${items.length}] ${(item.uuid || item.src || '').slice(0, 60)}: ${err.message}`);
        }
      }

      spinner.succeed(chalk.green(`Saved ${saved}/${items.length} item(s) to ${outputDir}`));
      return;
    }

    console.log(chalk.red(`Unknown media subcommand: ${subcommand}`));
    console.log(chalk.gray('Usage: flow media [list|latest [n]|get <uuid>]'));
  } catch (err) {
    console.error(chalk.red('Media command failed: ' + err.message));
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
