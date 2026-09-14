import fs from 'fs';
import path from 'path';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

/**
 * Reads a local reference image and returns { name, path, dataUrl } for the
 * extension (the debugger-based upload path uses `path`, drop/paste fallbacks
 * use `dataUrl`).
 */
export function loadRefImage(refPath) {
  const resolved = path.resolve(refPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Reference image not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`Unsupported reference image type "${ext}" (use png/jpg/webp/gif): ${resolved}`);
  }
  const data = fs.readFileSync(resolved).toString('base64');
  return { name: path.basename(resolved), path: resolved, dataUrl: `data:${mime};base64,${data}` };
}
