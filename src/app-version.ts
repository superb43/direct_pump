import project from '../package.json' with { type: 'json' };

/** One build-time version for extension and server operational diagnostics. */
export const APP_VERSION = project.version;
