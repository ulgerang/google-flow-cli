import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(size, r = 99, g = 102, b = 241) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // Scanlines: each row starts with filter byte 0
  const rowBytes = 1 + size * 4;
  const rawData = Buffer.alloc(size * rowBytes);

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter none
    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      // Gradient effect
      const factor = (x + y) / (size * 2);
      rawData[pxOffset] = Math.min(255, Math.floor(r * (0.8 + factor * 0.4)));     // R
      rawData[pxOffset + 1] = Math.min(255, Math.floor(g * (0.8 + factor * 0.4))); // G
      rawData[pxOffset + 2] = Math.min(255, Math.floor(b * (0.8 + factor * 0.4))); // B
      rawData[pxOffset + 3] = 255; // Alpha
    }
  }

  const idat = makeChunk('IDAT', zlib.deflateSync(rawData));
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdr, idat, iend]);
}

const iconsDir = path.resolve('extension', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 32, 48, 128].forEach((size) => {
  const pngBuf = createPng(size, 99, 102, 241);
  const dest = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(dest, pngBuf);
  console.log(`Generated: ${dest} (${size}x${size})`);
});
