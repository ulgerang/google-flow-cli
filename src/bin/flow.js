#!/usr/bin/env node

import { Command } from 'commander';
import { handleStatus } from '../commands/status.js';
import { handleOpen } from '../commands/open.js';
import { handleImage } from '../commands/image.js';
import { handleVideo } from '../commands/video.js';
import { handleProjects } from '../commands/projects.js';
import { handleCharacters } from '../commands/characters.js';
import { handleMedia } from '../commands/media.js';
import { handleServe } from '../commands/serve.js';
import { handleMcp } from '../commands/mcp.js';

const program = new Command();

program
  .name('flow')
  .description('Google Flow CLI - Generate AI images & videos via Chrome Extension bridge')
  .version('1.0.0');

// Global option
program.option('--port <port>', 'Bridge server port', 58231);

// flow status
program
  .command('status')
  .description('Check Google Flow bridge connection & Chrome tab status')
  .action(async (cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleStatus(opts);
  });

// flow open
program
  .command('open')
  .description('Open or focus Google Flow in your Chrome browser')
  .action(async (cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleOpen(opts);
  });

// flow image <prompt>
program
  .command('image <prompt>')
  .description('Generate an image using Google Flow AI models')
  .option('-m, --model <model>', 'Image model ("Nano Banana 2", "Nano Banana Pro", "Imagen 4")', 'Nano Banana 2')
  .option('-r, --ratio <ratio>', 'Aspect ratio ("16:9", "9:16", "1:1", "4:3", "3:4")', '16:9')
  .option('-n, --outputs <count>', 'Number of outputs per generation (1-4)', '1')
  .option('-o, --output <dir>', 'Directory to save output files', './flow_output')
  .option('--dry-run', 'Setup prompt and model in Flow without clicking generate', false)
  .option('-t, --timeout <seconds>', 'Max generation wait time in seconds', '180')
  .action(async (prompt, cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleImage(prompt, opts);
  });

// flow video <prompt>
program
  .command('video <prompt>')
  .description('Setup or generate a video using Google Flow models')
  .option('-m, --model <model>', 'Video model ("Veo 3.1 - Fast", "Veo 3.1 - Quality", "Omni Flash")', 'Veo 3.1 - Fast')
  .option('-r, --ratio <ratio>', 'Aspect ratio ("16:9", "9:16")', '16:9')
  .option('-d, --duration <duration>', 'Video duration ("4s", "6s", "8s", "10s")', '4s')
  .option('-n, --outputs <count>', 'Number of outputs per generation (1-4)', '1')
  .option('-o, --output <dir>', 'Directory to save output files', './flow_output')
  .option('--confirm', 'Confirm generation (consumes video credits)', false)
  .action(async (prompt, cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleVideo(prompt, opts);
  });

// flow characters
program
  .command('characters')
  .description('List characters defined in the open Flow project (reference them with @tag)')
  .action(async (cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleCharacters(opts);
  });

// flow media [subcommand] [arg]
program
  .command('media [subcommand] [arg]')
  .description('Manage media in the open project (list, latest [n], get <uuid>)')
  .option('-o, --output <dir>', 'Directory to save downloaded files', './flow_output')
  .action(async (subcommand = 'list', arg = null, cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleMedia(subcommand, arg, opts);
  });

// flow projects [subcommand] [name]
program
  .command('projects [subcommand] [name]')
  .description('Manage projects in Google Flow (list, new <name>)')
  .action(async (subcommand = 'list', name = null, cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleProjects(subcommand, name, opts);
  });

// flow serve
program
  .command('serve')
  .description('Start the Google Flow WebSocket & HTTP bridge server')
  .option('-p, --port <port>', 'Port number to listen on', '58231')
  .action(async (cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleServe(opts);
  });

// flow mcp
program
  .command('mcp')
  .description('Run as an MCP (Model Context Protocol) server over stdio')
  .action(async (cmdOptions) => {
    const opts = { ...program.opts(), ...cmdOptions };
    await handleMcp(opts);
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
