import { defineConfig } from 'wxt';
import { SITE_MATCHES } from './src/sites/catalog';

export default defineConfig({
  vite: () => ({ define: { 'process.env.ANCHOR_BROWSER': JSON.stringify('true') } }),
  manifest: {
    name: 'Direct Pump',
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' },
    action: { default_icon: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png' } },
    description: 'Keep the terminal. Skip the terminal fee. Trade Solana on Axiom, GMGN & FOMO Family. Open source.',
    permissions: ['storage', 'scripting', 'sidePanel', 'alarms'],
    optional_permissions: ['notifications'],
    host_permissions: [
      ...SITE_MATCHES,
      'https://api.mainnet-beta.solana.com/*',
      'https://solana-rpc.publicnode.com/*',
      'https://api.coinbase.com/*',
      'https://api.exchange.coinbase.com/*',
    ],
    optional_host_permissions: ['https://*/*'],
    minimum_chrome_version: '116',
    commands: Object.fromEntries(['buy', 'sell'].flatMap(side => Array.from({ length: 8 }, (_, index) => {
      const slot = index + 1;
      const defaultKey = side === 'buy' && slot <= 2 ? slot : side === 'sell' && slot === 1 ? 3 : side === 'sell' && slot === 4 ? 4 : undefined;
      return [`pro-${side}-${slot}`, { description: `Pro ${side} preset ${slot}`, ...(defaultKey ? { suggested_key: { default: `Alt+Shift+${defaultKey}` } } : {}) }];
    }))),
  },
});
