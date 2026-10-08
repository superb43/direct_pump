import { browser } from 'wxt/browser';
import type { PageTarget } from './model';
import type { WalletResult } from './wallet-bridge';
import { walletFailure } from './wallet-bridge';

export type SigningFrame = { tabId: number; documentId: string; pageUrl: string };
const targetFrame = (frame: Pick<SigningFrame, 'tabId' | 'documentId'>) => ({ tabId: frame.tabId, documentIds: [frame.documentId] });

async function inject(frame: SigningFrame) {
  await browser.scripting.executeScript({ target: targetFrame(frame), world: 'MAIN', files: ['/phantom-main.js'] });
}

export async function currentFrameUrl(frame: Pick<SigningFrame, 'tabId' | 'documentId'>): Promise<string> {
  const result = await browser.scripting.executeScript({ target: targetFrame(frame), world: 'ISOLATED', func: () => location.href });
  const url = result[0]?.result;
  if (typeof url !== 'string') throw new Error('Could not read the current document URL. Reload the page.');
  return url;
}

export async function connectPhantom(frame: SigningFrame, target: PageTarget): Promise<string> {
  await inject(frame);
  const results = await browser.scripting.executeScript({ target: targetFrame(frame), world: 'MAIN', args: [target],
    func: async (page: PageTarget) => window.__directPumpWallet?.connect(page),
  });
  const response = results[0]?.result;
  if (!response?.wallet) throw new Error(response?.error ?? 'The Phantom connection bridge did not respond.');
  return response.wallet;
}

export async function restorePhantom(frame: SigningFrame, target: PageTarget): Promise<string | undefined> {
  await inject(frame);
  const results = await browser.scripting.executeScript({ target: targetFrame(frame), world: 'MAIN', args: [target],
    func: async (page: PageTarget) => window.__directPumpWallet?.restore(page),
  });
  return results[0]?.result?.wallet;
}

export async function switchPhantom(frame: SigningFrame, target: PageTarget): Promise<string> {
  await inject(frame);
  const results = await browser.scripting.executeScript({ target: targetFrame(frame), world: 'MAIN', args: [target],
    func: async (page: PageTarget) => window.__directPumpWallet?.switchWallet(page),
  });
  const response = results[0]?.result;
  if (!response?.wallet) throw new Error(response?.error ?? 'Select an account in Phantom, then reconnect.');
  return response.wallet;
}

export async function preparePhantom(frame: SigningFrame, target: PageTarget, wallet: string, bytes: number[], orderId: string): Promise<void> {
  try {
    await inject(frame);
    const results = await browser.scripting.executeScript({ target: targetFrame(frame), world: 'MAIN', args: [orderId, target, wallet, bytes],
      func: (id: string, page: PageTarget, account: string, transaction: number[]) => {
        const bridge = window.__directPumpWallet;
        if (!bridge) return { state: 'NOT_SENT' as const, invoked: false, error: 'Could not load the Phantom bridge.' };
        return bridge.prepare(id, page, account, transaction) ?? { state: 'READY' as const };
      },
    });
    const result = results[0]?.result;
    if (!result || result.state !== 'READY') throw new Error(result && 'error' in result ? result.error : 'The Phantom preparation bridge did not respond.');
  } catch (error) { throw new Error(walletFailure(error, false).error); }
}

export async function inspectPhantom(frame: Pick<SigningFrame, 'tabId' | 'documentId'>, orderId: string, cancelPrepared = false) {
  const results = await browser.scripting.executeScript({ target: targetFrame(frame), world: 'MAIN', args: [orderId, cancelPrepared],
    func: (id: string, cancel: boolean) => {
      const bridge = window.__directPumpWallet;
      if (cancel) bridge?.cancelPrepared(id);
      return bridge?.inspect(id);
    },
  });
  return results[0]?.result;
}

export async function sendWithPhantom(frame: SigningFrame, orderId: string): Promise<WalletResult> {
  try {
    const results = await browser.scripting.executeScript({ target: targetFrame(frame), world: 'MAIN', args: [orderId],
      func: async (id: string) => window.__directPumpWallet?.send(id),
    });
    if (results[0]?.result) return results[0].result;
    throw new Error('No Phantom bridge execution result was returned.');
  } catch (error) {
    try {
      const record = await inspectPhantom(frame, orderId);
      if (record?.result) return record.result;
      if (record?.stage === 'PREPARED') return walletFailure(error, false);
    } catch { /* A vanished document cannot prove whether the wallet was invoked. */ }
    return walletFailure(error, true);
  }
}
