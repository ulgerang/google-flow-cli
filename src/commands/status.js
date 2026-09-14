import chalk from 'chalk';
import ora from 'ora';
import { BridgeClient } from '../bridge/client.js';

export async function handleStatus(options = {}) {
  const client = new BridgeClient(options);
  const spinner = ora('Checking Google Flow bridge & extension status...').start();

  try {
    const serverStatus = await client.checkServerRunning();

    if (!serverStatus.running) {
      spinner.info(chalk.yellow('Bridge server is not currently running.'));
      console.log(`
${chalk.bold('Bridge Status:')} ${chalk.red('Offline')}
${chalk.gray(`Default port: ${client.port}`)}

${chalk.cyan('Tips to get started:')}
 1. Make sure Chrome is open with the ${chalk.bold('Google Flow CLI Bridge')} extension installed.
 2. Run ${chalk.green('flow serve')} to start the persistent bridge server, OR
 3. Run any command directly (e.g. ${chalk.green('flow image "a sunset"')}), which will auto-start the bridge.
`);
      return;
    }

    spinner.succeed(chalk.green('Bridge server is running!'));

    console.log(`
${chalk.bold('--- System Status ---')}
${chalk.bold('Bridge Server:')}      ${chalk.green('Active')} (http://${client.host}:${client.port})
${chalk.bold('Extension Client:')}  ${serverStatus.extensionConnected ? chalk.green('Connected ✔') : chalk.yellow('Waiting for Chrome Extension ⚠')}
`);

    if (serverStatus.extensionConnected) {
      try {
        const flowStatus = await client.execute('get_status', {}, { timeoutMs: 10000 });
        console.log(`${chalk.bold('--- Google Flow Tab ---')}`);
        console.log(`${chalk.bold('Current URL:')}         ${flowStatus.url}`);
        console.log(`${chalk.bold('In Project:')}          ${flowStatus.inProject ? chalk.green('Yes') : chalk.yellow('No (Flow Root)')}`);
        console.log(`${chalk.bold('Active Model:')}        ${chalk.cyan(flowStatus.activeModel)}`);
        console.log(`${chalk.bold('Prompt Bar:')}          ${flowStatus.promptInputAvailable ? chalk.green('Ready') : chalk.red('Not Found')}`);
        console.log(`${chalk.bold('Existing Media:')}      ${flowStatus.mediaCount} items detected`);
      } catch (err) {
        console.log(chalk.gray(`Could not query active Flow tab details: ${err.message}`));
      }
    } else {
      console.log(chalk.yellow('💡 Open Google Chrome and check the extension icon in the toolbar.'));
    }
  } catch (err) {
    spinner.fail(chalk.red('Status check failed: ' + err.message));
  } finally {
    await client.close();
  }
}
