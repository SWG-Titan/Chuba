/**
 * ES Module wrapper for STFReader
 * Re-exports the STFReader class for use in ES modules
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create require function for use inside evaluated code
const requireFn = createRequire(import.meta.url);

// Read stf-reader.js source
const stfReaderPath = join(__dirname, 'stf-reader.js');
const stfReaderCode = fs.readFileSync(stfReaderPath, 'utf8');

// Remove the CommonJS export code at the end
const cleanCode = stfReaderCode
    .replace(/if\s*\(\s*typeof\s+module\s*!==\s*['"]undefined['"]\s*&&\s*module\.exports\s*\)\s*\{[\s\S]*?}/g, '');

// Create a sandbox context with require and other globals
const moduleExports = {};
const moduleObj = { exports: moduleExports };

const sandbox = {
    require: requireFn,
    module: moduleObj,
    exports: moduleExports,
    console: console,
    Buffer: Buffer,
    TextDecoder: TextDecoder,
    TextEncoder: TextEncoder,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    __dirname: __dirname,
    __filename: stfReaderPath,
};

// Create context and run the code
vm.createContext(sandbox);

// Wrap code to capture the class definitions
const wrappedCode = `
${cleanCode}

// Store in module.exports for retrieval
module.exports = { STFReader, loadSTF };
`;

let STFReader, loadSTF;

try {
    vm.runInContext(wrappedCode, sandbox, { filename: stfReaderPath });
    STFReader = sandbox.module.exports.STFReader;
    loadSTF = sandbox.module.exports.loadSTF;

    if (!STFReader) {
        console.error('STFReader class not found in evaluated code');
        STFReader = null;
    }
} catch (error) {
    console.error('Failed to load STFReader:', error.message);
    console.error('Stack:', error.stack);
    throw error;
}

export { STFReader, loadSTF };
