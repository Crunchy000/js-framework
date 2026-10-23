// A tiny static file server for the tests, serving the repo root like GitHub Pages does.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

module.exports = function start() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(0, () => resolve({ url: 'http://localhost:' + server.address().port, close: () => server.close() }));
  });
};
