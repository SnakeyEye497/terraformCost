// Bundles src/extension.js (+ the rest of src/) and runtime dependencies (debounce, exceljs) into
// dist/extension.js, so the packaged .vsix doesn't need to ship node_modules.
// `vscode` is provided by the extension host at runtime and must stay external.

const path = require('path');

/** @type {import('webpack').Configuration} */
module.exports = (env, argv) => ({
    target: 'node',
    mode: argv.mode || 'none',
    entry: './src/extension.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    externals: {
        vscode: 'commonjs vscode'
    },
    resolve: {
        extensions: ['.js'],
        mainFields: ['main', 'module']
    },
    devtool: argv.mode === 'production' ? false : 'nosources-source-map',
    infrastructureLogging: {
        level: 'log'
    },
    performance: {
        hints: false
    }
});
