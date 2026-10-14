import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {claimSignerProcess} from '../../server/signer-lock';
import {startSignerDaemon,SignerClient} from '../../server/signer';
import {generateKeyPairSync} from 'node:crypto';
import {createKeystore} from '../../server/keystore';
import {DEFAULT_SETTINGS} from '../../src/model';
it('prevents a second signer from replacing a live process socket',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'pro-single-signer-')),path=join(folder,'owner.lock');
  try{const release=await claimSignerProcess(path);await expect(claimSignerProcess(path)).rejects.toThrow('already running');await release();const next=await claimSignerProcess(path);await next();}finally{await rm(folder,{recursive:true,force:true});}
});
it('does not race to remove an existing stale lock',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'pro-stale-signer-')),path=join(folder,'owner.lock');
  try{await writeFile(path,'2147483647',{mode:0o600});const claims=await Promise.allSettled([claimSignerProcess(path),claimSignerProcess(path)]);expect(claims.every(result=>result.status==='rejected')).toBe(true);expect(await readFile(path,'utf8')).toBe('2147483647');}finally{await rm(folder,{recursive:true,force:true});}
});
it('releases its process lock after Node removes closed Unix sockets, allowing a locked restart',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'pro-daemon-restart-'));
  const config={serverId:'restart-test',socketPath:join(folder,'api.sock'),adminSocketPath:join(folder,'admin.sock'),keystorePath:join(folder,'key.enc'),authPath:join(folder,'auth.db'),journalPath:join(folder,'journal.db'),rpcUrl:'https://rpc.invalid',settings:DEFAULT_SETTINGS,limits:{maxBuyLamports:'100000',dailyBuyLamports:'200000',maxNetworkLamports:'10000'}};
  let daemon:Awaited<ReturnType<typeof startSignerDaemon>>|undefined;
  try{
    await createKeystore(config.keystorePath,'test-only-restart-password');
    daemon=await startSignerDaemon(config);expect(daemon.authority.status()).toBe('LOCKED');
    const client=new SignerClient(config.socketPath,config.adminSocketPath);
    const publicKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'der'}).toString('base64');
    await expect(client.pair('not-an-issued-code',publicKey)).rejects.toThrow('Generate a new code on your server');
    await expect(client.call('unknown-method')).rejects.toThrow('inspect private server diagnostics');
    await daemon.close();daemon=undefined;
    await expect(readFile(`${config.journalPath}.lock`)).rejects.toMatchObject({code:'ENOENT'});
    daemon=await startSignerDaemon(config);expect(daemon.authority.status()).toBe('LOCKED');
  }finally{if(daemon)await daemon.close();await rm(folder,{recursive:true,force:true});}
});
