import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';

/**
 * flow assets list — list registered assets (uploads + generated media)
 * usable as ingredient references, with the index/label accepted by --asset.
 */
export async function handleAssets(options = {}) {
  const client = new BridgeClient(options);
  const spinner = ora('Listing assets in the open Flow project...').start();

  try {
    const assets = await client.execute(
      'list_assets',
      {},
      {
        timeoutMs: 25000,
        onStatusUpdate: (msg) => {
          spinner.text = msg;
        }
      }
    );

    if (!assets || assets.length === 0) {
      spinner.info(chalk.yellow('No assets found. Generate an image (`flow image`) or upload one first.'));
      return;
    }

    spinner.succeed(chalk.green(`Found ${assets.length} asset(s):`));
    assets.forEach((a) => {
      console.log(`  ${chalk.bold.cyan(`[${a.index}]`)} ${a.label}`);
    });
    console.log(
      chalk.gray('\nUse as a reference with: flow image "..." --asset <index or label>')
    );
  } catch (err) {
    spinner.fail(chalk.red('Failed to list assets: ' + err.message));
  } finally {
    await client.close();
  }
}
