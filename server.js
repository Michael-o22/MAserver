const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const IMAGE_DIR = path.join(__dirname, 'image');

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
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // Handle POST endpoint for image uploads to /image folder
  if (req.method === 'POST' && req.url === '/api/upload') {
    let body = '';
    const MAX_SIZE = 15 * 1024 * 1024; // 15MB max limit

    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > MAX_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Payload too large (max 15MB)' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const { image, filename } = JSON.parse(body);
        if (!image) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'No image data provided' }));
        }

        let ext = 'jpg';
        let base64Data = image;

        const matches = image.match(/^data:image\/([a-zA-Z0-9-+.]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const rawExt = matches[1].toLowerCase();
          if (rawExt === 'jpeg' || rawExt === 'jpg') ext = 'jpg';
          else if (rawExt === 'png') ext = 'png';
          else if (rawExt === 'webp') ext = 'webp';
          else if (rawExt === 'gif') ext = 'gif';
          else ext = 'jpg';
          base64Data = matches[2];
        } else if (filename) {
          const parsedExt = path.extname(filename).replace('.', '').toLowerCase();
          if (parsedExt) ext = parsedExt;
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

  // Static file server with Directory Traversal Protection
  const reqUrl = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(reqUrl).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(__dirname, safePath === '/' || safePath === '\\' ? 'index.html' : safePath);

  // Guard against path traversal outside root
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
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

