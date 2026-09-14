import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';
import { saveMediaItem } from '../utils/file-saver.js';
import { DEFAULT_CONFIG } from '../config/default-config.js';

export async function handleImage(prompt, options = {}) {
  if (!prompt || !prompt.trim()) {
    console.error(chalk.red('Error: Prompt is required. Example: flow image "A futuristic floating city"'));
    process.exit(1);
  }

  const model = options.model || DEFAULT_CONFIG.defaultImageModel;
  const ratio = options.ratio || DEFAULT_CONFIG.defaultRatio;
  const outputs = Math.min(4, Math.max(1, parseInt(options.outputs, 10) || 1));
  const outputDir = path.resolve(options.output || DEFAULT_CONFIG.outputDir);
  const dryRun = options.dryRun || false;
  const timeoutMs = (parseInt(options.timeout, 10) || 180) * 1000;

  console.log(`
${chalk.bold.magenta('🎨 Google Flow Image Generation')}
${chalk.gray('----------------------------------------')}
${chalk.bold('Prompt:')}   ${chalk.cyan(prompt)}
${chalk.bold('Model:')}    ${chalk.yellow(model)}
${chalk.bold('Ratio:')}    ${chalk.blue(ratio)}
${chalk.bold('Outputs:')}  ${chalk.blue(`x${outputs}`)}
${chalk.bold('Output:')}   ${chalk.gray(outputDir)}
${dryRun ? chalk.bold.yellow('[DRY RUN - Setup only, will not generate]') : ''}
${chalk.gray('----------------------------------------')}
`);

  const client = new BridgeClient(options);
  const spinner = ora('Connecting to Chrome extension bridge...').start();

  try {
    const result = await client.execute(
      'generate_image',
      {
        prompt,
        model,
        ratio,
        outputs,
        dryRun,
        timeoutMs
      },
      {
        timeoutMs: timeoutMs + 10000,
        onStatusUpdate: (msg) => {
          spinner.text = msg;
        },
        onProgress: (progress) => {
          spinner.text = `Generating image in Google Flow... (${progress.elapsedSec}s elapsed)`;
        }
      }
    );

    if (dryRun) {
      spinner.succeed(chalk.green('Dry run completed successfully!'));
      console.log(chalk.cyan(`\n${result.message || 'Prompt and parameters ready in Flow tab.'}`));
      return;
    }

    spinner.succeed(chalk.green(`Generation completed in ${Math.round((result.elapsedMs || 0) / 1000)}s!`));

    const mediaList = result.media || [];
    if (mediaList.length === 0) {
      console.log(chalk.yellow('\n⚠ Generation completed, but no downloadable image payload was returned.'));
      console.log(chalk.gray('Check your Google Flow browser tab to view the generated assets.'));
      return;
    }

    console.log(chalk.bold(`\nSaving ${mediaList.length} generated image(s)...`));

    const savedFiles = [];
    for (let i = 0; i < mediaList.length; i++) {
      const item = mediaList[i];
      if (item.dataUrl) {
        const saved = await saveMediaItem({
          outputDir,
          type: 'image',
          data: item.dataUrl,
          metadata: {
            prompt,
            model,
            ratio,
            uuid: item.uuid,
            source: 'google-flow'
          }
        });
        savedFiles.push(saved);
        console.log(
          `  ${chalk.green('✔')} [${i + 1}/${mediaList.length}] Saved: ${chalk.bold.underline(
            saved.filePath
          )} (${(saved.size / 1024).toFixed(1)} KB)`
        );
      } else if (item.url) {
        console.log(`  ${chalk.blue('🔗')} [${i + 1}/${mediaList.length}] Image URL: ${chalk.underline(item.url)}`);
      }
    }

    console.log(`
${chalk.bold.green('✨ All Done!')} Images are ready in: ${chalk.bold(outputDir)}
`);
  } catch (err) {
    spinner.fail(chalk.red('Image generation failed: ' + err.message));
    process.exit(1);
  } finally {
    await client.close();
  }
}
