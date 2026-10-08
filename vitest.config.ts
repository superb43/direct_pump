import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/**/*.test.ts'], server: { deps: { inline: ['@pump-fun/pump-sdk', '@pump-fun/agent-payments-sdk'] } } } });
