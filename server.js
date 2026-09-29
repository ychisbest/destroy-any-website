// Destroy Any Website clone — zero-dependency Node server
// - serves /public
// - /proxy?url=...  (or ?room=CODE) fetches a page, strips scripts, injects <base>
// - /ws             minimal WebSocket server for multiplayer rooms (max 6 players)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const PORT = process.env.PORT || 3000;
// honour HTTP(S)_PROXY / NO_PROXY for outgoing fetches (Node >= 24)
const HAS_PROXY = !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
if (HAS_PROXY && typeof http.setGlobalProxyFromEnv === 'function') http.setGlobalProxyFromEnv();
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

// ---------------------------------------------------------------- proxy
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') ||
    (l.startsWith('::ffff:') && isPrivateIp(l.slice(7)));
}

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('empty url');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  return u;
}

async function fetchPage(input) {
  let u = normalizeUrl(input);
  for (let hop = 0; hop < 6; hop++) {
    if (/^(localhost|.*\.local)$/i.test(u.hostname)) throw new Error('private address not allowed');
    let address = null;
    try { ({ address } = await dns.lookup(u.hostname)); } catch (e) { if (!HAS_PROXY) throw e; }
    if (address && isPrivateIp(address)) throw new Error('private address not allowed');
    const res = await fetch(u, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = new URL(res.headers.get('location'), u);
      continue;
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) throw new Error('not an html page (' + ct + ')');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error('page too large');
    return { html: buf.toString('utf8'), finalUrl: u.href };
  }
  throw new Error('too many redirects');
}

function sanitize(html, baseUrl) {
  html = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/gi, '$1') // no JS -> show fallbacks
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?(refresh|content-security-policy)["']?[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sloading\s*=\s*["']?lazy["']?/gi, '')
    // lazy-load patterns: promote data-src to src
    .replace(/<img\b([^>]*?)\sdata-src\s*=\s*("[^"]*"|'[^']*')/gi, '<img$1 src=$2');
  const inject = `<base href="${baseUrl.replace(/"/g, '&quot;')}"><meta name="referrer" content="no-referrer">`;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + inject);
  else html = inject + html;
  return html;
}

// ---------------------------------------------------------------- rooms
const rooms = new Map(); // code -> room

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

// ---------------------------------------------------------------- http
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/proxy') {
      let html, finalUrl;
      const room = u.searchParams.get('room');
      if (room) {
        const r = rooms.get(room.toUpperCase());
        if (!r) throw new Error('room not found');
        ({ html, finalUrl } = await r.page);
      } else {
        ({ html, finalUrl } = await fetchPage(u.searchParams.get('url')));
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-final-url': encodeURI(finalUrl) });
      return res.end(sanitize(html, finalUrl));
    }
    let p = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font:16px monospace;padding:40px"><h1>Could not load page</h1><p>${String(e.message).replace(/</g, '&lt;')}</p></body></html>`);
  }
});

// ---------------------------------------------------------------- websocket (RFC 6455, text frames only)
function wsSend(sock, obj) {
  if (sock.destroyed) return;
  const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  sock.write(Buffer.concat([header, data]));
}

server.on('upgrade', (req, sock) => {
  if (!req.url.startsWith('/ws')) return sock.destroy();
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);

  const client = { sock, id: crypto.randomBytes(4).toString('hex'), room: null, name: 'Player' };
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(need);
      if (op === 0x8) { sock.end(Buffer.from([0x88, 0])); return; }
      if (op === 0x9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 0x1) {
        let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
        onMessage(client, msg);
      }
    }
  });
  sock.on('close', () => leave(client));
  sock.on('error', () => leave(client));
});

function broadcast(room, msg, except) {
  const s = JSON.stringify(msg);
  for (const c of room.clients.values()) if (c !== except) wsSend(c.sock, s);
}

function roomInfo(room) {
  return {
    t: 'room', code: room.code, url: room.url, host: room.host, firstTo: room.firstTo, over: room.over,
    players: [...room.clients.values()].map((c) => ({ id: c.id, name: c.name, color: c.color, kills: c.kills, deaths: c.deaths })),
  };
}

const COLORS = ['#ff3b3b', '#3b8cff', '#2ecc40', '#ffb000', '#b14bff', '#ff5fcf'];

function join(client, room) {
  if (room.clients.size >= 6) return wsSend(client.sock, { t: 'error', msg: 'Room is full (6 players max)' });
  const used = new Set([...room.clients.values()].map((c) => c.color));
  client.color = COLORS.find((c) => !used.has(c)) || COLORS[0];
  client.kills = 0; client.deaths = 0;
  client.room = room;
  room.clients.set(client.id, client);
  wsSend(client.sock, { t: 'welcome', id: client.id, color: client.color });
  broadcast(room, roomInfo(room));
}

function leave(client) {
  const room = client.room;
  if (!room) return;
  room.clients.delete(client.id);
  client.room = null;
  if (room.clients.size === 0) { rooms.delete(room.code); return; }
  if (room.host === client.id) room.host = room.clients.keys().next().value;
  broadcast(room, { t: 'left', id: client.id });
  broadcast(room, roomInfo(room));
}

function onMessage(client, m) {
  const room = client.room;
  switch (m.t) {
    case 'create': {
      client.name = String(m.name || 'Player').slice(0, 16);
      const code = makeCode();
      const r = { code, url: String(m.url), host: client.id, firstTo: Math.max(1, Math.min(99, m.firstTo | 0 || 10)), clients: new Map(), over: false };
      r.page = fetchPage(m.url);
      r.page.catch(() => {});
      rooms.set(code, r);
      r.page.then(() => join(client, r), (e) => { rooms.delete(code); wsSend(client.sock, { t: 'error', msg: 'Could not load page: ' + e.message }); });
      break;
    }
    case 'join': {
      client.name = String(m.name || 'Player').slice(0, 16);
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return wsSend(client.sock, { t: 'error', msg: 'Room not found' });
      join(client, r);
      break;
    }
    case 'killed': { // victim reports own death
      if (!room || room.over) return;
      client.deaths++;
      const killer = room.clients.get(m.by);
      if (killer && killer !== client) killer.kills++;
      broadcast(room, { t: 'kill', victim: client.id, by: m.by, weapon: m.weapon });
      if (killer && killer.kills >= room.firstTo) {
        room.over = true;
        broadcast(room, { t: 'over', winner: killer.id });
      }
      broadcast(room, roomInfo(room));
      break;
    }
    case 'restart': {
      if (!room || room.host !== client.id) return;
      room.over = false;
      for (const c of room.clients.values()) { c.kills = 0; c.deaths = 0; }
      broadcast(room, { t: 'restart' });
      broadcast(room, roomInfo(room));
      break;
    }
    default: // relay gameplay messages (state, fire, blk, hit ...)
      if (room) { m.id = client.id; broadcast(room, m, client); }
  }
}

server.listen(PORT, () => console.log(`Destroy Any Website clone running at http://localhost:${PORT}`));
