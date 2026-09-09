const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function compressDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            compressDirectory(file);
        } else if (/\.(html|js|css|wasm|json|svg)$/.test(entry.name)) {
            const source = fs.readFileSync(file);
            fs.writeFileSync(file + '.br', zlib.brotliCompressSync(source, {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
            }));
            fs.writeFileSync(file + '.gz', zlib.gzipSync(source, { level: 9 }));
        }
    }
}

compressDirectory(path.resolve(__dirname, '../dist'));
