// Builds the self-contained index.html by inlining the stylesheet and
// scripts from dev.html, so the game runs from a single downloaded file.
'use strict';

const fs = require('fs');
const path = require('path');

function build() {
  const root = __dirname;
  let html = fs.readFileSync(path.join(root, 'dev.html'), 'utf8');

  html = html.replace(
    /<link rel="stylesheet" href="([^"]+)">/,
    (m, href) =>
      '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '</style>'
  );
  html = html.replace(
    /<script src="([^"]+)"><\/script>/g,
    (m, src) =>
      '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8') + '</script>'
  );
  html = html.replace(
    '<head>',
    '<head>\n<!-- Generated from dev.html by build.js — edit the sources, not this file. -->'
  );

  fs.writeFileSync(path.join(root, 'index.html'), html);
  return path.join(root, 'index.html');
}

if (require.main === module) {
  console.log('Built', build());
}

module.exports = { build };
