const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const crypto = require('crypto');

// Railway PORT орчны хувьсагчаас уншина, байхгүй бол 3000
const PORT = process.env.PORT || 3000;

// Railway тогтмол домэйн (deploy хийсний дараа автоматаар тохируулагдана)
const PUBLIC_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : null;

const DATA_FILE = path.join(__dirname, 'applications.json');
const PHOTOS_DIR = path.join(__dirname, 'photos');

// HR нууц үг — Railway Variables дээр HR_PASSWORD тохируулна
const HR_PASSWORD = process.env.HR_PASSWORD || 'kfc2026';

// Session токенуудыг санах (сервер дахин асахад арилна)
const sessions = new Set();

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? match.split('=')[1] : null;
}

function isLoggedIn(req) {
  const token = getCookie(req, 'hr_session');
  return token && sessions.has(token);
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HR Нэвтрэх</title>
  <style>
    body { font-family: Arial; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 320px; text-align: center; }
    h1 { color: #c8102e; margin-bottom: 4px; }
    p { color: #888; font-size: 14px; margin-bottom: 24px; }
    input { width: 100%; padding: 11px 14px; border: 1px solid #ddd; border-radius: 6px; font-size: 15px; box-sizing: border-box; margin-bottom: 14px; }
    input:focus { outline: none; border-color: #c8102e; }
    button { width: 100%; padding: 12px; background: #c8102e; color: white; border: none; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; }
    button:hover { background: #a00d25; }
    .error { background: #fee2e2; color: #991b1b; padding: 10px; border-radius: 6px; font-size: 13px; margin-bottom: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>KFC</h1>
    <p>Хүний нөөцийн систем</p>
    ${error ? `<div class="error">Нууц үг буруу байна</div>` : ''}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Нууц үг оруулна уу" autofocus required>
      <button type="submit">Нэвтрэх</button>
    </form>
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const ip = getLocalIP();

  // Анкетын форм (нэвтрэх шаардлагагүй)
  if (req.method === 'GET' && req.url === '/') {
    serveFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');

  // Зураг өгөх
  } else if (req.method === 'GET' && req.url.startsWith('/photos/')) {
    const filename = req.url.replace('/photos/', '');
    const ext = path.extname(filename).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    serveFile(res, path.join(PHOTOS_DIR, filename), mime[ext] || 'image/jpeg');

  // Нэвтрэх — GET
  } else if (req.method === 'GET' && req.url === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(loginPage(false));

  // Нэвтрэх — POST
  } else if (req.method === 'POST' && req.url === '/login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      if (params.get('password') === HR_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.add(token);
        res.writeHead(302, {
          'Set-Cookie': `hr_session=${token}; HttpOnly; Path=/`,
          'Location': '/hr'
        });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage(true));
      }
    });

  // Гарах
  } else if (req.method === 'GET' && req.url === '/logout') {
    const token = getCookie(req, 'hr_session');
    if (token) sessions.delete(token);
    res.writeHead(302, { 'Set-Cookie': 'hr_session=; Max-Age=0; Path=/', 'Location': '/login' });
    res.end();

  // QR код (нэвтрэх шаардлагагүй, анкетын URL харуулна)
  } else if (req.method === 'GET' && req.url === '/qr') {
    const publicUrl = PUBLIC_URL || `http://${ip}:${PORT}`;
    const isOnline = !!PUBLIC_URL;
    QRCode.toDataURL(publicUrl, { width: 280, margin: 2, color: { dark: '#c8102e', light: '#ffffff' } }, (err, dataUrl) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"><title>QR Код</title>
  <style>
    body { font-family: Arial; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 360px; }
    h1 { color: #c8102e; margin: 0 0 6px; }
    p { color: #666; margin: 0 0 24px; font-size: 14px; }
    .url { background: #f5f5f5; padding: 10px 16px; border-radius: 6px; font-family: monospace; font-size: 13px; color: #333; margin: 16px 0; word-break: break-all; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-bottom: 20px; }
    a { color: #c8102e; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>KFC — Анкет</h1>
    <p>Утасны камераар уншаад бөглөнө үү</p>
    <img src="${dataUrl}" width="280" height="280">
    <div class="url">${publicUrl}</div>
    <div class="badge">${isOnline ? '🌐 Railway — Интернэтэд нийтлэгдсэн' : '📶 Локал сүлжээ'}</div>
    <br><a href="/hr">← HR хуудас</a>
  </div>
</body>
</html>`);
    });

  // HR dashboard — нэвтрэлт шаардлагатай
  } else if (req.method === 'GET' && req.url.startsWith('/hr')) {
    if (!isLoggedIn(req)) {
      res.writeHead(302, { 'Location': '/login' }); res.end(); return;
    }
    const urlObj = new URL(req.url, `http://localhost`);
    const search = (urlObj.searchParams.get('search') || '').toLowerCase();
    const filterType = urlObj.searchParams.get('type') || '';

    let data = readData();
    if (search) data = data.filter(a =>
      (`${a.last_name} ${a.first_name} ${a.name}`).toLowerCase().includes(search) ||
      (a.phone || '').includes(search) || (a.email || '').toLowerCase().includes(search)
    );
    if (filterType) data = data.filter(a => a.position_type === filterType);

    const all = readData();
    const officeCount = all.filter(a => a.position_type === 'Оффис').length;
    const branchCount = all.filter(a => a.position_type === 'Салбар').length;

    const rows = data.map((app, i) => {
      const name = `${app.last_name || ''} ${app.first_name || app.name || ''}`.trim();
      const pos = app.position || app.position_branch || '-';
      const photo = app.photo
        ? `<img src="/photos/${app.photo}" style="width:44px;height:44px;object-fit:cover;border-radius:50%;border:2px solid #eee;">`
        : `<div style="width:44px;height:44px;border-radius:50%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:18px;">👤</div>`;
      return `<tr>
        <td style="text-align:center">${photo}</td>
        <td><b>${name}</b></td>
        <td>${app.phone || '-'}</td>
        <td>${app.email || '-'}</td>
        <td><span style="background:${app.position_type==='Оффис'?'#dbeafe':'#dcfce7'};color:${app.position_type==='Оффис'?'#1d4ed8':'#166534'};padding:2px 10px;border-radius:12px;font-size:12px">${app.position_type || '-'}</span></td>
        <td>${pos}</td>
        <td style="color:#888;font-size:13px">${app.date || '-'}</td>
        <td><a href="/detail/${all.indexOf(app)}" style="color:#c8102e;font-size:13px">Харах →</a></td>
      </tr>`;
    }).join('');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"><title>HR Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial; margin: 0; background: #f5f5f5; }
    .header { background: #c8102e; color: white; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; }
    .header h1 { margin: 0; font-size: 18px; }
    .header-links { display: flex; gap: 10px; }
    .header a { color: white; text-decoration: none; background: rgba(255,255,255,0.2); padding: 7px 14px; border-radius: 6px; font-size: 13px; }
    .stats { display: flex; gap: 14px; padding: 20px 28px 0; }
    .stat { background: white; padding: 18px 24px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); flex: 1; }
    .stat .num { font-size: 28px; font-weight: bold; color: #c8102e; }
    .stat .label { font-size: 12px; color: #888; margin-top: 2px; }
    .controls { padding: 16px 28px; display: flex; gap: 10px; flex-wrap: wrap; }
    .controls input, .controls select { padding: 8px 13px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
    .controls input { flex: 1; min-width: 200px; }
    .controls button { padding: 8px 18px; background: #c8102e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .table-wrap { padding: 0 28px 28px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
    th { background: #c8102e; color: white; padding: 11px 13px; text-align: left; font-size: 13px; }
    td { padding: 11px 13px; border-bottom: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
    tr:hover td { background: #fff8f8; }
    .empty { text-align: center; padding: 40px; color: #999; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🍗 KFC — Хүний нөөцийн систем</h1>
    <div class="header-links">
      <a href="/qr">📱 QR Код</a>
      <a href="/logout">Гарах</a>
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="num">${all.length}</div><div class="label">Нийт өргөдөл</div></div>
    <div class="stat"><div class="num">${officeCount}</div><div class="label">Оффис</div></div>
    <div class="stat"><div class="num">${branchCount}</div><div class="label">Салбар</div></div>
    <div class="stat"><div class="num">${data.length}</div><div class="label">Хайлтын үр дүн</div></div>
  </div>
  <form class="controls" method="GET" action="/hr">
    <input type="text" name="search" placeholder="Нэр, утас, имэйлээр хайх..." value="${search}">
    <select name="type">
      <option value="">Бүх төрөл</option>
      <option ${filterType==='Оффис'?'selected':''}>Оффис</option>
      <option ${filterType==='Салбар'?'selected':''}>Салбар</option>
    </select>
    <button type="submit">Хайх</button>
    <a href="/hr" style="padding:8px 14px;color:#666;text-decoration:none;font-size:14px">Цэвэрлэх</a>
  </form>
  <div class="table-wrap">
    <table>
      <tr><th></th><th>Нэр</th><th>Утас</th><th>Имэйл</th><th>Төрөл</th><th>Ажлын байр</th><th>Огноо</th><th></th></tr>
      ${rows || '<tr><td colspan="8" class="empty">Өргөдөл олдсонгүй</td></tr>'}
    </table>
  </div>
</body>
</html>`);

  // Дэлгэрэнгүй харах
  } else if (req.method === 'GET' && req.url.startsWith('/detail/')) {
    if (!isLoggedIn(req)) { res.writeHead(302, { 'Location': '/login' }); res.end(); return; }
    const idx = parseInt(req.url.replace('/detail/', ''));
    const data = readData();
    const app = data[idx];
    if (!app) { res.writeHead(404); res.end('Олдсонгүй'); return; }
    const name = `${app.last_name || ''} ${app.first_name || app.name || ''}`.trim();
    const photo = app.photo
      ? `<img src="/photos/${app.photo}" style="width:110px;height:110px;object-fit:cover;border-radius:8px;border:3px solid #eee;">`
      : `<div style="width:110px;height:110px;border-radius:8px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:44px;">👤</div>`;
    const rows = Object.entries(app).filter(([k]) => k !== 'photo')
      .map(([k, v]) => `<tr><td style="color:#888;font-size:13px;padding:8px 12px;white-space:nowrap;background:#fafafa">${k}</td><td style="padding:8px 12px">${v || '-'}</td></tr>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${name}</title>
<style>body{font-family:Arial;background:#f5f5f5;padding:28px}.card{background:white;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:680px;margin:0 auto;padding:28px}.top{display:flex;gap:20px;align-items:flex-start;margin-bottom:20px}h2{margin:0 0 4px;color:#c8102e}table{width:100%;border-collapse:collapse}tr:nth-child(even) td{background:#fafafa}a{color:#c8102e}</style>
</head>
<body>
<div class="card">
  <div class="top">${photo}<div><h2>${name}</h2><p style="margin:4px 0;color:#555">${app.position || app.position_branch || ''}</p><p style="margin:4px 0;font-size:12px;color:#999">${app.date || ''}</p></div></div>
  <table>${rows}</table>
  <br><a href="/hr">← Буцах</a>
</div>
</body></html>`);

  // Форм илгээх
  } else if (req.method === 'POST' && req.url === '/apply') {
    let body = Buffer.alloc(0);
    req.on('data', chunk => { body = Buffer.concat([body, chunk]); });
    req.on('end', () => {
      const params = new URLSearchParams(body.toString('utf8'));
      const application = {};
      for (const [key, val] of params.entries()) {
        if (key !== 'photo_data') application[key] = val;
      }
      const photoData = params.get('photo_data');
      if (photoData && photoData.startsWith('data:image')) {
        const matches = photoData.match(/^data:image\/(\w+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const filename = `photo_${Date.now()}.${ext}`;
          fs.writeFileSync(path.join(PHOTOS_DIR, filename), Buffer.from(matches[2], 'base64'));
          application.photo = filename;
        }
      }
      application.date = new Date().toLocaleString('mn-MN');
      const data = readData();
      data.push(application);
      saveData(data);
      const name = `${application.last_name || ''} ${application.first_name || ''}`.trim() || 'Таны';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Амжилттай</title></head>
<body style="font-family:Arial;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:400px;text-align:center">
    <div style="font-size:52px">✅</div>
    <h2 style="color:#16a34a;margin:12px 0">Амжилттай илгээгдлээ!</h2>
    <p style="color:#555">${name}, таны өргөдлийг хүлээн авлаа.<br>Бид тантай удахгүй холбоо барина.</p>
    <a href="/" style="display:inline-block;margin-top:16px;padding:11px 28px;background:#c8102e;color:white;border-radius:6px;text-decoration:none;font-weight:bold">← Буцах</a>
  </div>
</body></html>`);
    });

  } else {
    res.writeHead(404); res.end('Хуудас олдсонгүй');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`Сервер: http://localhost:${PORT}`);
  if (PUBLIC_URL) {
    console.log(`Railway URL: ${PUBLIC_URL}`);
  } else {
    console.log(`Локал сүлжээ: http://${ip}:${PORT}`);
  }
  console.log(`HR: /hr  (нууц үг: ${HR_PASSWORD})`);
});
