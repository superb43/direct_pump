import { it, expect, vi } from 'vitest';
import { main, installSignerShutdown } from '../server/cli';
it('requires an encrypted backup destination before prompting or creating state', async () => { const argv = process.argv; process.argv = ['node', 'test-runner', 'setup', '--state-dir', '/private/tmp/unused-pro-test']; try {
    await expect(main()).rejects.toThrow('encrypted backup file is required');
}
finally {
    process.argv = argv;
} });
it('locks signing immediately and awaits journal/socket cleanup before systemd exit',async()=>{
    const signals=new Map<string,()=>void>();
    const exit=vi.fn();const lock=vi.fn();let finish!:()=>void;
    const close=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    installSignerShutdown({authority:{lock},close},{once:(signal:string,handler:()=>void)=>{signals.set(signal,handler);return {} as NodeJS.Process;},exit} as never);
    signals.get('SIGTERM')!();signals.get('SIGINT')!();
    expect(lock).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(exit).not.toHaveBeenCalled();
    finish();await Promise.resolve();expect(exit).toHaveBeenCalledWith(0);
});
it('reports failed cleanup without treating a signer restart as clean',async()=>{
    const signals=new Map<string,()=>void>();const exit=vi.fn();
    installSignerShutdown({authority:{lock:vi.fn()},close:async()=>{throw new Error('Cleanup failed.');}},{once:(signal:string,handler:()=>void)=>{signals.set(signal,handler);return {} as NodeJS.Process;},exit} as never);
    signals.get('SIGTERM')!();await Promise.resolve();await Promise.resolve();expect(exit).toHaveBeenCalledWith(1);
});
