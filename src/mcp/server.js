import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { BridgeClient } from '../bridge/client.js';
import { saveMediaItem } from '../utils/file-saver.js';
import { DEFAULT_CONFIG } from '../config/default-config.js';

export async function runMcpServer(options = {}) {
  const client = new BridgeClient(options);

  const server = new Server(
    {
      name: 'google-flow-bridge',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'flow_status',
          description: 'Check Google Flow bridge connection, Chrome extension status, and active project tab',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'flow_open',
          description: 'Open or focus Google Flow in the user Chrome browser',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'flow_generate_image',
          description: 'Generate AI images using Google Flow (Nano Banana 2, Nano Banana Pro, Imagen 4) via user Chrome browser',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The creative prompt describing the image to generate'
              },
              model: {
                type: 'string',
                description: 'Model name: "Nano Banana 2", "Nano Banana Pro", or "Imagen 4"',
                default: 'Nano Banana 2'
              },
              ratio: {
                type: 'string',
                description: 'Aspect ratio: "16:9", "9:16", "1:1", "4:3", "3:4"',
                default: '16:9'
              },
              outputs: {
                type: 'number',
                description: 'Number of images per generation (1-4)',
                default: 1
              },
              output_dir: {
                type: 'string',
                description: 'Directory path to save generated images',
                default: './flow_output'
              },
              auto_confirm: {
                type: 'boolean',
                description: 'Set to true to click generate and produce image; false for setup only',
                default: true
              }
            },
            required: ['prompt']
          }
        },
        {
          name: 'flow_generate_video',
          description: 'Generate AI video in Google Flow (Veo 3.1, Omni Flash). Notice: Video uses credits, confirm required.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The prompt describing the video scene'
              },
              model: {
                type: 'string',
                description: 'Model name: "Veo 3.1 - Fast", "Veo 3.1 - Quality", "Omni Flash"',
                default: 'Veo 3.1 - Fast'
              },
              ratio: {
                type: 'string',
                description: 'Aspect ratio: "16:9" or "9:16"',
                default: '16:9'
              },
              duration: {
                type: 'string',
                description: 'Video duration: "4s", "6s", "8s", "10s"',
                default: '4s'
              },
              confirm: {
                type: 'boolean',
                description: 'Explicit confirmation to trigger generation and consume video credits',
                default: false
              }
            },
            required: ['prompt']
          }
        },
        {
          name: 'flow_list_projects',
          description: 'List user projects on Google Flow homepage',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'flow_list_characters',
          description: 'List characters defined in the open Flow project (reference them in prompts with @tag)',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'flow_list_media',
          description: 'List media UUIDs visible in the open Flow project',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'flow_get_media',
          description: 'Download a media item by UUID and save it to disk',
          inputSchema: {
            type: 'object',
            properties: {
              uuid: { type: 'string', description: 'Media UUID (from flow_list_media)' },
              output_dir: { type: 'string', description: 'Directory to save the file', default: './flow_output' }
            },
            required: ['uuid']
          }
        },
        {
          name: 'flow_create_project',
          description: 'Create a new project workspace in Google Flow',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the project to create',
                default: 'New Project'
              }
            }
          }
        }
      ]
    };
  });

  // Handle tool executions
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      if (name === 'flow_status') {
        const serverStatus = await client.checkServerRunning();
        let tabInfo = null;
        if (serverStatus.extensionConnected) {
          tabInfo = await client.execute('get_status', {}, { timeoutMs: 5000 }).catch(() => null);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  bridgeServer: serverStatus.running ? 'running' : 'stopped',
                  extensionConnected: serverStatus.extensionConnected || false,
                  flowTab: tabInfo
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'flow_open') {
        const result = await client.execute('open_flow', {});
        return {
          content: [
            {
              type: 'text',
              text: `Google Flow opened in Chrome tab: ${result?.url || 'https://labs.google/fx/tools/flow'}`
            }
          ]
        };
      }

      if (name === 'flow_generate_image') {
        const prompt = args.prompt;
        const model = args.model || DEFAULT_CONFIG.defaultImageModel;
        const ratio = args.ratio || DEFAULT_CONFIG.defaultRatio;
        const outputDir = path.resolve(args.output_dir || DEFAULT_CONFIG.outputDir);
        const dryRun = args.auto_confirm === false;

        const result = await client.execute('generate_image', {
          prompt,
          model,
          ratio,
          outputs: Math.min(4, Math.max(1, parseInt(args.outputs, 10) || 1)),
          dryRun,
          timeoutMs: 180000
        });

        if (dryRun) {
          return {
            content: [
              {
                type: 'text',
                text: `Dry run completed. Image setup ready: model=${model}, ratio=${ratio}.`
              }
            ]
          };
        }

        const savedFiles = [];
        for (const item of result.media || []) {
          if (item.dataUrl) {
            const saved = await saveMediaItem({
              outputDir,
              type: 'image',
              data: item.dataUrl,
              metadata: { prompt, model, ratio, uuid: item.uuid }
            });
            savedFiles.push(saved.filePath);
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'success',
                  prompt,
                  model,
                  ratio,
                  generatedCount: savedFiles.length,
                  files: savedFiles
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'flow_generate_video') {
        const prompt = args.prompt;
        const model = args.model || DEFAULT_CONFIG.defaultVideoModel;
        const ratio = args.ratio || DEFAULT_CONFIG.defaultRatio;
        const duration = args.duration || DEFAULT_CONFIG.defaultDuration;
        const confirm = args.confirm === true;

        const result = await client.execute('generate_video', {
          prompt,
          model,
          ratio,
          duration,
          confirm
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      if (name === 'flow_list_projects') {
        const projects = await client.execute('list_projects', {});
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(projects, null, 2)
            }
          ]
        };
      }

      if (name === 'flow_list_characters') {
        const result = await client.execute('list_characters', {}, { timeoutMs: 20000 });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'flow_list_media') {
        const result = await client.execute('list_media', {}, { timeoutMs: 15000 });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'flow_get_media') {
        const src = args.src || null;
        const uuid = args.uuid || null;
        if (!src && !uuid) {
          return { content: [{ type: 'text', text: 'Provide either src (opaque tile URL) or uuid' }] };
        }
        const media = await client.execute('fetch_media', { src, uuid }, { timeoutMs: 60000 });
        const outputDir = path.resolve(args.output_dir || DEFAULT_CONFIG.outputDir);
        if (!media.dataUrl) {
          return {
            content: [{ type: 'text', text: `Could not fetch data for ${uuid || (src || '').slice(0, 60)}` }]
          };
        }
        const saved = await saveMediaItem({
          outputDir,
          type: (media.mimeType || '').startsWith('video/') ? 'video' : 'image',
          data: media.dataUrl,
          metadata: { src, uuid, mimeType: media.mimeType, source: 'google-flow-mcp' }
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ saved: saved.filePath, size: saved.size, uuid }, null, 2) }]
        };
      }

      if (name === 'flow_create_project') {
        const result = await client.execute('ensure_project', { projectName: args.name });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${err.message}`
          }
        ]
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
