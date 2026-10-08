import { Buffer } from 'buffer';

// A transitive official SDK uses Buffer at module initialization in browsers.
globalThis.Buffer = Buffer;
