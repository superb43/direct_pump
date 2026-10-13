import {constants} from 'node:fs';
import {open,unlink} from 'node:fs/promises';

/** A second signer cannot replace the live socket and bypass process-local sequencing. */
export async function claimSignerProcess(path:string):Promise<()=>Promise<void>>{
  try{
    const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    try{await file.writeFile(String(process.pid));await file.sync();}finally{await file.close();}
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let pid:number;
    try{const stat=await file.stat();if(!stat.isFile()||stat.size>32||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)throw new Error('Invalid signer lock.');pid=Number(await file.readFile('utf8'));}finally{await file.close();}
    if(!Number.isSafeInteger(pid)||pid!<=0)throw new Error('Signer lock needs operator inspection.');
    throw new Error(`Another signer is already running, or its lock remains (PID ${pid}). Confirm that the signer is stopped before the operator removes its private lock.`);
  }
  return async()=>{const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let owner:string;try{owner=(await file.readFile('utf8')).trim();}finally{await file.close();}if(owner===String(process.pid))await unlink(path);};
}
