/**
 * Default configuration for Google Flow CLI and Extension Bridge
 */
export const DEFAULT_CONFIG = {
  // Bridge server configuration
  port: 58231,
  host: '127.0.0.1',
  wsUrl: 'ws://127.0.0.1:58231',

  // Google Flow URLs
  flowUrl: 'https://labs.google/fx/tools/flow',
  flowUrlFr: 'https://labs.google/fx/fr/tools/flow',

  // Supported Image Models
  imageModels: {
    'Nano Banana 2': 'nano-banana-2',
    'Nano Banana Pro': 'nano-banana-pro',
    'Imagen 4': 'imagen-4'
  },
  defaultImageModel: 'Nano Banana 2',

  // Supported Video Models
  videoModels: {
    'Omni Flash': 'omni-flash',
    'Veo 3.1 - Fast': 'veo-3.1-fast',
    'Veo 3.1 - Lite': 'veo-3.1-lite',
    'Veo 3.1 - Quality': 'veo-3.1-quality'
  },
  defaultVideoModel: 'Veo 3.1 - Fast',

  // Supported Aspect Ratios
  ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  defaultRatio: '16:9',

  // Supported Video Durations
  durations: ['4s', '6s', '8s', '10s'],
  defaultDuration: '4s',

  // Default Directories & Timeouts
  outputDir: './flow_output',
  connectionTimeoutMs: 30000,
  generationTimeoutMs: 180000, // 3 minutes
  pollIntervalMs: 2000
};
