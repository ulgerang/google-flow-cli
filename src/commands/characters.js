import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';

export async function handleCharacters(options = {}) {
  const client = new BridgeClient(options);
  const spinner = ora('Listing characters in the current Flow project...').start();

  try {
    const result = await client.execute(
      'list_characters',
      {},
      {
        timeoutMs: 20000,
        onStatusUpdate: (msg) => {
          spinner.text = msg;
        }
      }
    );

    if (!result.inProject) {
      spinner.info(chalk.yellow('Not inside a project. Open a project first: `flow open`, then pick a project.'));
      return;
    }

    const characters = result.characters || [];
    if (characters.length === 0) {
      spinner.succeed(chalk.green('No character tiles found in this project.'));
      console.log(chalk.gray('Create one via the Flow UI banner ("Create a character") or the sidebar 캐릭터 tab.'));
      return;
    }

    spinner.succeed(chalk.green(`Found ${characters.length} character item(s):`));
    characters.forEach((c, i) => {
      console.log(`  ${chalk.bold.cyan(`[${i + 1}]`)} ${c}`);
    });
    console.log(chalk.gray('\nReference characters in prompts with their @tag.'));
  } catch (err) {
    spinner.fail(chalk.red('Failed to list characters: ' + err.message));
  } finally {
    await client.close();
  }
}
