const path = require('node:path');

const root = __dirname;
const executable = process.platform === 'win32' ? 'mdread.exe' : 'mdread';
const appBinaryPath = process.env.APP_BINARY
  || path.resolve(root, 'src-tauri', 'target', 'debug', executable);
const fixturePath = path.resolve(root, 'e2e', 'fixtures', 'reader-sample.md');

exports.config = {
  runner: 'local',
  specs: ['./e2e/**/*.e2e.cjs'],
  maxInstances: 1,
  injectGlobals: true,
  logLevel: 'warn',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 2,
  // Node 26's bundled undici rejects a user-supplied Content-Length for this
  // WebDriver request. Let undici calculate it from the serialized body.
  transformRequest: (request) => {
    request.headers.delete('content-length');
    return request;
  },
  services: [['@wdio/tauri-service', {
    appBinaryPath,
    appArgs: [fixturePath],
    driverProvider: 'embedded',
    embeddedPort: 4445,
  }]],
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: appBinaryPath,
      args: [fixturePath],
    },
  }],
  framework: 'jasmine',
  jasmineOpts: {
    defaultTimeoutInterval: 60_000,
  },
  reporters: ['spec'],
};
