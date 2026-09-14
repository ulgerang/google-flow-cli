import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';
import { loadRefImage } from '../utils/ref-image.js';
import { resolveFrames } from '../utils/frames.js';
import { DEFAULT_CONFIG } from '../config/default-config.js';

export async function handleVideo(prompt, options = {}) {
  if (!prompt || !prompt.trim()) {
    console.error(chalk.red('Error: Prompt is required. Example: flow video "A cinematic drone shot over waterfalls"'));
    process.exit(1);
  }

  const model = options.model || DEFAULT_CONFIG.defaultVideoModel;
  const ratio = options.ratio || DEFAULT_CONFIG.defaultRatio;
  const duration = options.duration || DEFAULT_CONFIG.defaultDuration;
  const outputs = Math.min(4, Math.max(1, parseInt(options.outputs, 10) || 1));
  const refs = (options.ref || []).map(loadRefImage);
  const assets = (options.asset || []).map(String);
  const frames = resolveFrames(options);
  const confirm = options.confirm === true;

  console.log(`
${chalk.bold.magenta('🎬 Google Flow Video Generation')}
${chalk.gray('----------------------------------------')}
${chalk.bold('Prompt:')}    ${chalk.cyan(prompt)}
${chalk.bold('Model:')}     ${chalk.yellow(model)}
${chalk.bold('Ratio:')}     ${chalk.blue(ratio)}
${chalk.bold('Duration:')}  ${chalk.green(duration)}
${chalk.bold('Outputs:')}   ${chalk.blue(`x${outputs}`)}
${refs.length ? `${chalk.bold('Refs:')}     ${chalk.cyan(refs.map((r) => r.name).join(', '))}\n` : ''}${assets.length ? `${chalk.bold('Assets:')}   ${chalk.cyan(assets.join(', '))}\n` : ''}${frames.start ? `${chalk.bold('Start frame:')} ${chalk.cyan(frames.start.name || frames.start.query)}\n` : ''}${frames.end ? `${chalk.bold('End frame:')}   ${chalk.cyan(frames.end.name || frames.end.query)}\n` : ''}${confirm ? chalk.bold.red('⚠️ --confirm passed: Credits will be consumed!') : chalk.bold.yellow('ℹ Setup Mode (No credits consumed without --confirm)')}
${chalk.gray('----------------------------------------')}
`);

  const client = new BridgeClient(options);
  const spinner = ora('Connecting to Chrome extension bridge...').start();

  try {
    const result = await client.execute(
      'generate_video',
      {
        prompt,
        model,
        ratio,
        duration,
        outputs,
        refs,
        assets,
        frames: Object.keys(frames).length ? frames : undefined,
        confirm
      },
      {
        onStatusUpdate: (msg) => {
          spinner.text = msg;
        }
      }
    );

    if (!confirm) {
      spinner.succeed(chalk.green('Video setup completed in Google Flow!'));
      if (result.frames) {
        console.log(chalk.gray(`Frames: ${JSON.stringify(result.frames)}`));
      }
      if (result.refs) {
        console.log(chalk.gray(`Ingredients/refs: ${JSON.stringify(result.refs)}`));
      }
      if (result.activeSettings) {
        console.log(chalk.gray(`Active settings: ${JSON.stringify(result.activeSettings)}`));
      }
      console.log(`
${chalk.yellow('To trigger generation and consume video credits, re-run with the ' + chalk.bold('--confirm') + ' flag.')}
`);
      return;
    }

    spinner.succeed(chalk.green('Video generation triggered successfully!'));
    console.log(`
${chalk.green('✔ Video is now rendering in Google Flow.')}
Check your Google Flow browser tab for progress and downloading.
`);
  } catch (err) {
    spinner.fail(chalk.red('Video generation failed: ' + err.message));
    process.exit(1);
  } finally {
    await client.close();
  }
}
