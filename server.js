const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT_DIR = path.normalize(__dirname);
const IMAGE_DIR = path.join(ROOT_DIR, 'image');
const MAX_PAYLOAD_SIZE = 15 * 1024 * 1024; // 15 MB limit
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']);

if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Common security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Handle POST endpoint for image uploads to /image folder
  if (req.method === 'POST' && req.url === '/api/upload') {
    let body = '';
    let bodyLength = 0;

    req.on('data', chunk => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_PAYLOAD_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Payload too large. Max 15MB allowed.' }));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      if (res.writableEnded) return;

      try {
        const { image, filename } = JSON.parse(body);
        if (!image) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'No image data provided' }));
        }

        const matches = image.match(/^data:image\/([a-zA-Z0-9-+.]+);base64,(.+)$/);
        let ext = 'jpg';
        let base64Data = image;

        if (matches && matches.length === 3) {
          ext = matches[1] === 'jpeg' ? 'jpg' : matches[1].toLowerCase();
          base64Data = matches[2];
        } else if (filename) {
          const parsedExt = path.extname(filename).replace('.', '').toLowerCase();
          if (parsedExt) ext = parsedExt;
        }

        if (!ALLOWED_EXTENSIONS.has(ext)) {
          ext = 'jpg';
        }

        const newFileName = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
        const filePath = path.join(IMAGE_DIR, newFileName);
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFile(filePath, buffer, err => {
          if (err) {
            console.error('Error saving image:', err);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Failed to save image file' }));
          }
          console.log(`Uploaded image saved: ${newFileName}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, url: `image/${newFileName}` }));
        });
      } catch (e) {
        console.error('Upload parse error:', e);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // Static file server with Path Traversal Protection
  let safePath;
  try {
    const reqUrl = decodeURIComponent(req.url.split('?')[0]);
    safePath = path.normalize(path.join(ROOT_DIR, reqUrl === '/' ? 'index.html' : reqUrl));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>400 Bad Request</h1>');
  }

  if (!safePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>403 Forbidden</h1>');
  }

  const ext = path.extname(safePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(safePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server audit app running at http://localhost:${PORT}`);
});

