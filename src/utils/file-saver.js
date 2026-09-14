import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Saves media items (base64 DataURLs or Buffers) to output folder
 */
export async function saveMediaItem({ outputDir, type = 'image', data, filename, metadata }) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomSuffix = crypto.randomBytes(3).toString('hex');
  let extension = type === 'video' ? '.mp4' : '.png';
  let buffer;

  if (typeof data === 'string') {
    if (data.startsWith('data:')) {
      const match = data.match(/^data:(image\/[a-zA-Z0-9+]+|video\/[a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        const mime = match[1];
        if (mime.includes('jpeg') || mime.includes('jpg')) extension = '.jpg';
        else if (mime.includes('webp')) extension = '.webp';
        else if (mime.includes('png')) extension = '.png';
        else if (mime.includes('mp4')) extension = '.mp4';
        buffer = Buffer.from(match[2], 'base64');
      } else {
        buffer = Buffer.from(data, 'base64');
      }
    } else {
      buffer = Buffer.from(data, 'base64');
    }
  } else if (Buffer.isBuffer(data)) {
    buffer = data;
  } else {
    throw new Error('Unsupported media data type for saving');
  }

  const baseName = filename || `flow_${type}_${timestamp}_${randomSuffix}${extension}`;
  const targetPath = path.resolve(outputDir, baseName);

  fs.writeFileSync(targetPath, buffer);

  // Save metadata sidecar JSON
  if (metadata) {
    const metaPath = path.resolve(outputDir, `${path.parse(baseName).name}.meta.json`);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          ...metadata,
          savedFile: targetPath,
          fileSize: buffer.length,
          savedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
  }

  return {
    filePath: targetPath,
    fileName: baseName,
    size: buffer.length
  };
}
