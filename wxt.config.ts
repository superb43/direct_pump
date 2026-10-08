import { defineConfig } from 'wxt';
import { SITE_MATCHES } from './src/sites/catalog';

export default defineConfig({
  vite: () => ({ define: { 'process.env.ANCHOR_BROWSER': JSON.stringify('true') } }),
  manifest: {
    name: 'Direct Pump',
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' },
    action: { default_icon: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png' } },
    description: 'Buy or sell supported Pump tokens on the current page with Phantom approval.',
    permissions: ['storage', 'scripting', 'sidePanel'],
    host_permissions: [
      ...SITE_MATCHES,
      'https://api.mainnet-beta.solana.com/*',
      'https://solana-rpc.publicnode.com/*',
      'https://api.coinbase.com/*',
      'https://api.exchange.coinbase.com/*',
    ],
    optional_host_permissions: ['https://*/*'],
    minimum_chrome_version: '116',
  },
});
