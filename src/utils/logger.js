import chalk from 'chalk';

export const logger = {
  info(msg, meta) {
    console.log(`${chalk.blue('ℹ')} ${chalk.bold(msg)} ${meta ? chalk.gray(JSON.stringify(meta)) : ''}`);
  },
  success(msg, meta) {
    console.log(`${chalk.green('✔')} ${chalk.green.bold(msg)} ${meta ? chalk.gray(JSON.stringify(meta)) : ''}`);
  },
  warn(msg, meta) {
    console.warn(`${chalk.yellow('⚠')} ${chalk.yellow(msg)} ${meta ? chalk.gray(JSON.stringify(meta)) : ''}`);
  },
  error(msg, meta) {
    console.error(`${chalk.red('✖')} ${chalk.red.bold(msg)} ${meta ? chalk.gray(JSON.stringify(meta)) : ''}`);
  },
  debug(msg, meta) {
    if (process.env.DEBUG || process.env.FLOW_DEBUG) {
      console.log(`${chalk.magenta('🔍')} ${chalk.gray(msg)} ${meta ? chalk.gray(JSON.stringify(meta)) : ''}`);
    }
  },
  step(stepNum, totalSteps, title) {
    console.log(`${chalk.cyan(`[${stepNum}/${totalSteps}]`)} ${chalk.bold(title)}`);
  }
};
