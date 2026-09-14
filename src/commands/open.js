import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';

export async function handleOpen(options = {}) {
  const client = new BridgeClient(options);
  const spinner = ora('Opening Google Flow in Chrome...').start();

  try {
    const result = await client.execute(
      'open_flow',
      {},
      {
        timeoutMs: 15000,
        onStatusUpdate: (msg) => {
          spinner.text = msg;
        }
      }
    );

    spinner.succeed(chalk.green('Google Flow tab is open and ready in Chrome!'));
    if (result?.url) {
      console.log(`${chalk.bold('URL:')} ${chalk.cyan(result.url)}`);
    }
  } catch (err) {
    spinner.fail(chalk.red('Failed to open Google Flow: ' + err.message));
  } finally {
    await client.close();
  }
}
