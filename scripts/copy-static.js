const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '..', 'src', 'renderer');
const destination = path.join(__dirname, '..', 'dist', 'renderer');
fs.mkdirSync(destination, { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file));
}
