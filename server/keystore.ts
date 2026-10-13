import { scrypt, randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Keypair } from '@solana/web3.js';

type Keystore = { version: 1; kdf: 'scrypt'; n: 131072; r: 8; p: 1; salt: string; iv: string; tag: string; ciphertext: string; wallet: string };
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));

export async function createKeystore(path: string, password: string): Promise<{ wallet: string }> {
  if (password.length < 12 || password.length > 1024) throw new Error('Use a passphrase of 12–1024 characters.');
  const pair = Keypair.generate(), salt = randomBytes(32), iv = randomBytes(12);
  const key = await derive(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const wallet = pair.publicKey.toBase58();
    cipher.setAAD(Buffer.from(`direct-pump-keystore-v1:${wallet}`));
    const ciphertext = Buffer.concat([cipher.update(pair.secretKey), cipher.final()]);
    const row: Keystore = { version: 1, kdf: 'scrypt', n: 131072, r: 8, p: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'), wallet };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await file.writeFile(JSON.stringify(row)); await file.sync(); } finally { await file.close(); }
    return { wallet };
  } finally { key.fill(0); pair.secretKey.fill(0); }
}

async function readStore(path: string): Promise<{ row: Keystore; bytes: Buffer }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096) throw new Error('Keystore must be a private regular file (0600).');
    const bytes = await file.readFile();
    const row = JSON.parse(bytes.toString('utf8')) as Keystore;
    if (row.version !== 1 || row.kdf !== 'scrypt' || row.n !== 131072 || row.r !== 8 || row.p !== 1 || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.wallet)) throw new Error('Unsupported keystore.');
    for (const [name, size] of [['salt',32],['iv',12],['tag',16],['ciphertext',64]] as const) if (typeof row[name] !== 'string' || Buffer.from(row[name], 'base64').length !== size) throw new Error('Invalid keystore.');
    return { row, bytes };
  } finally { await file.close(); }
}

export async function unlockKeystoreSecret(path: string, password: string): Promise<Uint8Array> {
  if (!password || password.length > 1024) throw new Error('Invalid passphrase.');
  const { row } = await readStore(path), key = await derive(password, Buffer.from(row.salt, 'base64'));
  let clear: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(`direct-pump-keystore-v1:${row.wallet}`));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    clear = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]);
    const pair = Keypair.fromSecretKey(clear);
    if (pair.publicKey.toBase58() !== row.wallet) throw new Error('Invalid keystore identity.');
    return new Uint8Array(clear);
  } catch { throw new Error('Keystore unlock failed.'); }
  finally { key.fill(0); clear?.fill(0); }
}
export async function unlockKeystore(path:string,password:string):Promise<Keypair>{return Keypair.fromSecretKey(await unlockKeystoreSecret(path,password));}

export async function keystoreWallet(path: string): Promise<string> { return (await readStore(path)).row.wallet; }
export async function backupKeystore(path: string, destination: string): Promise<string> {
  if (path === destination) throw new Error('Choose a separate encrypted backup path.');
  const { bytes } = await readStore(path);
  await copyFile(path, destination, constants.COPYFILE_EXCL);
  const backup = await open(destination, constants.O_WRONLY | constants.O_NOFOLLOW);
  try { await backup.chmod(0o600); await backup.sync(); } finally { await backup.close(); }
  return createHash('sha256').update(bytes).digest('hex');
}
