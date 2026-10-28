const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '..', 'src', 'renderer');
const destination = path.join(__dirname, '..', 'dist', 'renderer');
fs.mkdirSync(destination, { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file));
}
const assetDestination = path.join(destination, 'assets');
fs.mkdirSync(assetDestination, { recursive: true });
fs.copyFileSync(
  path.join(source, 'assets', 'renishaw-logo.png'),
  path.join(assetDestination, 'renishaw-logo.png')
);
