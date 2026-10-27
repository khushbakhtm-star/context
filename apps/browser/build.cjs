const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
require('./scripts/verify-shared.cjs');
const esbuild = require('esbuild');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(root, 'src/app.ts')], outfile: path.join(output, 'app.js'), bundle: true,
  format: 'iife', platform: 'browser', target: ['es2022'], minify: true, sourcemap: false,
  alias: { 'expo-crypto': path.join(root, 'src/crypto-browser.ts') } });
for (const name of ['index.html', 'app.css', 'config.json']) fs.copyFileSync(path.join(root, name), path.join(output, name));
fs.copyFileSync(path.join(root, 'assets/context-app-logo.png'), path.join(output, 'context-app-logo.png'));
process.stdout.write(`Browser build ready: ${fs.statSync(path.join(output, 'app.js')).size} bytes of JavaScript.\n`);
