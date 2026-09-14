import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';

export async function handleProjects(subcommand = 'list', name = null, options = {}) {
  const client = new BridgeClient(options);

  if (subcommand === 'list') {
    const spinner = ora('Scanning projects in Google Flow...').start();
    try {
      const projects = await client.execute('list_projects', {}, {
        onStatusUpdate: (msg) => { spinner.text = msg; }
      });

      spinner.succeed(chalk.green(`Found ${projects.length} project(s) on Google Flow:`));

      if (projects.length === 0) {
        console.log(chalk.gray('  No projects found on homepage. Create one with `flow projects new <name>`.'));
      } else {
        projects.forEach((p, idx) => {
          console.log(`\n  ${chalk.bold.cyan(`[${idx + 1}] ${p.name}`)}`);
          if (p.url) console.log(`      ${chalk.gray('URL:')} ${p.url}`);
          if (p.summary) console.log(`      ${chalk.gray('Info:')} ${p.summary}`);
        });
      }
    } catch (err) {
      spinner.fail(chalk.red('Failed to list projects: ' + err.message));
    } finally {
      await client.close();
    }
  } else if (subcommand === 'new') {
    const projectName = name || 'New Project';
    const spinner = ora(`Creating project "${projectName}" in Google Flow...`).start();
    try {
      const result = await client.execute('ensure_project', { projectName }, {
        onStatusUpdate: (msg) => { spinner.text = msg; }
      });

      spinner.succeed(chalk.green(`Project "${projectName}" ready!`));
      console.log(`  ${chalk.bold('Status:')} ${chalk.cyan(result.status)}`);
      console.log(`  ${chalk.bold('URL:')}    ${chalk.cyan(result.url)}`);
    } catch (err) {
      spinner.fail(chalk.red('Failed to create project: ' + err.message));
    } finally {
      await client.close();
    }
  } else {
    console.log(chalk.red(`Unknown projects subcommand: ${subcommand}`));
    console.log(chalk.gray('Usage: flow projects [list|new <name>]'));
    await client.close();
  }
}
