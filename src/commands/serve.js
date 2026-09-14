import chalk from 'chalk';
import { BridgeServer } from '../bridge/server.js';
import { DEFAULT_CONFIG } from '../config/default-config.js';
import { logger } from '../utils/logger.js';

export async function handleServe(options = {}) {
  const port = parseInt(options.port, 10) || DEFAULT_CONFIG.port;
  const host = options.host || DEFAULT_CONFIG.host;

  const server = new BridgeServer({ port, host });

  console.log(`
${chalk.bold.gradient ? chalk.bold.cyan('⚡ Google Flow CLI Bridge Server') : chalk.bold.cyan('⚡ Google Flow CLI Bridge Server')}
${chalk.gray('====================================================')}
${chalk.bold('WebSocket URL:')}  ${chalk.green(`ws://${host}:${port}`)}
${chalk.bold('HTTP Status:')}    ${chalk.blue(`http://${host}:${port}/status`)}
${chalk.bold('Status:')}         ${chalk.yellow('Waiting for Chrome extension...')}
${chalk.gray('====================================================')}

${chalk.gray('To connect:')}
 1. Open Google Chrome.
 2. Load the unpacked extension from ${chalk.bold('google-flow-cli/extension')}.
 3. Open ${chalk.underline('https://labs.google/fx/tools/flow')}.
 4. Run CLI commands like: ${chalk.cyan('flow image "A majestic eagle"')}

${chalk.gray('Press Ctrl+C to stop the bridge server.\n')}
`);

  await server.start();

  // Monitor extension status
  let prevConnected = false;
  setInterval(() => {
    const isConnected = server.isExtensionConnected();
    if (isConnected !== prevConnected) {
      prevConnected = isConnected;
      if (isConnected) {
        logger.success('Chrome Extension connected and ready!');
      } else {
        logger.warn('Chrome Extension disconnected. Waiting for reconnection...');
      }
    }
  }, 1000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log(chalk.yellow('\nStopping Google Flow bridge server...'));
    await server.stop();
    console.log(chalk.green('Server stopped cleanly. Goodbye!'));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
