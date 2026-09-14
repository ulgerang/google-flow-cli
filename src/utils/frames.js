import fs from 'fs';
import path from 'path';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Resolves a frame spec value into { type, path | query, name }.
 * Values that look like file paths are read as local files; anything else is
 * treated as an asset query (label substring or index) resolved from the
 * project's asset picker.
 */
export function resolveFrameSpec(value, slot) {
  if (value === undefined || value === null || value === '') return null;
  const asString = String(value);
  const looksLikePath = /[\\/]/.test(asString) || IMAGE_EXTS.includes(path.extname(asString).toLowerCase());

  if (looksLikePath) {
    const resolved = path.resolve(asString);
    if (!fs.existsSync(resolved)) {
      throw new Error(`${slot} frame file not found: ${resolved}`);
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) {
      throw new Error(`${slot} frame must be an image (png/jpg/webp/gif): ${resolved}`);
    }
    return { slot, type: 'file', path: resolved, name: path.basename(resolved) };
  }
  return { slot, type: 'asset', query: asString };
}

export function resolveFrames(options) {
  const frames = {
    start: resolveFrameSpec(options.startFrame, 'start'),
    end: resolveFrameSpec(options.endFrame, 'end')
  };
  const cleaned = {};
  if (frames.start) cleaned.start = frames.start;
  if (frames.end) cleaned.end = frames.end;
  return cleaned;
}
