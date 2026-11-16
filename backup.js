// Резервная копия данных: ZIP с приглашениями и загруженными фото, раз в сутки — в Telegram владельцу.
// Ключи и пароли (data/settings.json) в копию не входят.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- минимальный ZIP (deflate), без сторонних библиотек ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
function makeZip(files) {
  const local = [], central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// ---------- сборка копии ----------
const TG_LIMIT = 49 * 1024 * 1024; // Telegram принимает файлы ботов до 50 МБ
function build({ db, uploadDir }) {
  const invites = Buffer.from(JSON.stringify(db));
  const files = [{ name: 'data/invites.json', data: invites }];
  let photos = 0, skipped = 0, size = invites.length;
  let list = [];
  try { list = fs.readdirSync(uploadDir).filter((f) => /^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(f)); } catch { list = []; }
  for (const f of list) {
    const data = fs.readFileSync(path.join(uploadDir, f));
    if (size + data.length > TG_LIMIT) { skipped++; continue; } // фото уже сжаты; если не влезают — только данные
    files.push({ name: `data/uploads/${f}`, data });
    size += data.length; photos++;
  }
  files.push({ name: 'КАК ВОССТАНОВИТЬ.txt', data: Buffer.from(RESTORE, 'utf8') });
  return { zip: makeZip(files), invites: Object.keys(db).length, photos, skipped };
}

const RESTORE = `Резервная копия сайта «Только да»

Внутри: data/invites.json (приглашения, ответы, оплаты) и data/uploads (фото).
Ключей и паролей здесь нет — их вводят заново в админке.

Как восстановить на Windows-сервере (PowerShell от администратора):
1. Stop-ScheduledTask TolkoDa
2. Распакуйте архив в C:\\tolko-da так, чтобы файлы легли в C:\\tolko-da\\data
   (существующие файлы — заменить).
3. Start-ScheduledTask TolkoDa
`;

module.exports = { build, makeZip, crc32 };
