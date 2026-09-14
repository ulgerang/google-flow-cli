import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';

/**
 * flow characters [list | create <description> | rename <name> | delete <name>]
 * Options: --name (new name for rename), --personality (personality text)
 */
export async function handleCharacters(action = 'list', value = null, options = {}) {
  const client = new BridgeClient(options);

  const run = (act, payload, timeoutMs = 40000) =>
    client.execute(act, payload, {
      timeoutMs,
      onStatusUpdate: (msg) => {
        spinner.text = msg;
      }
    });

  const spinner = ora('Working on Flow characters...').start();

  try {
    if (action === 'list') {
      const result = await run('list_characters', {}, 30000);
      const characters = result.characters || [];
      if (!result.inProject) {
        spinner.info(chalk.yellow('Not inside a project. Open a project first: `flow open`.'));
        return;
      }
      if (characters.length === 0) {
        spinner.succeed(chalk.green('No characters yet (the characters page shows the creation form).'));
        console.log(chalk.gray('Create one with: flow characters create "A friendly robot barista"'));
        return;
      }
      spinner.succeed(chalk.green(`Found ${characters.length} character(s):`));
      characters.forEach((c, i) => {
        console.log(`  ${chalk.bold.cyan(`[${i + 1}]`)} ${c.label}`);
      });
      console.log(
        chalk.gray('\nReference in prompts with @tag. Use `flow characters create|rename|delete` to manage.')
      );
      return;
    }

    if (action === 'create') {
      if (!value || !value.trim()) {
        spinner.fail(chalk.red('Usage: flow characters create "A friendly robot barista named Robo"'));
        return;
      }
      spinner.text = 'Generating character (this can take a minute)...';
      const result = await run(
        'create_character',
        { description: value.trim(), preset: options.preset, timeoutMs: 120000 },
        150000
      );
      spinner.succeed(chalk.green('Character created!'));
      if (result.url) console.log(`  ${chalk.bold('URL:')} ${chalk.cyan('https://flow.google.com' + result.url)}`);
      if (result.texts && result.texts.length) {
        console.log(`  ${chalk.bold('Page:')} ${chalk.gray(result.texts.slice(0, 3).join(' | ').slice(0, 120))}`);
      }
      console.log(chalk.gray('Rename with: flow characters rename "제목 없는 캐릭터" --name "Robo"'));
      return;
    }

    if (action === 'rename') {
      if (!value || !options.name) {
        spinner.fail(chalk.red('Usage: flow characters rename "<current name>" --name "<new name>" [--personality "..."]'));
        return;
      }
      const result = await run(
        'rename_character',
        { name: value, newName: options.name, personality: options.personality },
        60000
      );
      if (result.renamed === false) {
        spinner.warn(chalk.yellow('Save may not have been applied — check with `flow characters list`.'));
      } else {
        spinner.succeed(chalk.green(`Character renamed to "${options.name}"`));
      }
      if (result.personalitySet) console.log(chalk.gray('Personality updated.'));
      return;
    }

    if (action === 'delete') {
      if (!value) {
        spinner.fail(chalk.red('Usage: flow characters delete "<name>"'));
        return;
      }
      const result = await run('delete_character', { name: value }, 60000);
      if (result.deleted) {
        spinner.succeed(chalk.green(`Character deleted: ${value}`));
      } else {
        spinner.warn(chalk.yellow('Delete was not confirmed — check `flow characters list`.'));
      }
      return;
    }

    spinner.fail(chalk.red(`Unknown characters action: ${action}`));
    console.log(chalk.gray('Usage: flow characters [list | create <description> | rename <name> --name <new> | delete <name>]'));
  } catch (err) {
    spinner.fail(chalk.red('Characters command failed: ' + err.message));
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
