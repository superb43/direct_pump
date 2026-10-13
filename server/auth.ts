import { DatabaseSync } from 'node:sqlite';
import { createPublicKey, verify, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { authMessage, type AuthProof } from '../src/pro/contracts';
import { PairingCodeError } from './errors';

export class AuthRegistry {
  private db: DatabaseSync;
  constructor(path: string, readonly serverId: string) {
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, public_key TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS nonces(id TEXT PRIMARY KEY, at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS pairing(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);');
  }
  issuePairCode(now = Date.now()): string {
    const code = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM pairing WHERE expires < ?').run(now);
    this.db.prepare('INSERT INTO pairing VALUES(?,?)').run(createHash('sha256').update(code).digest('hex'), now + 300_000);
    return code;
  }
  pair(code: string, publicKeySpki: string, now = Date.now()): { deviceId: string; serverId: string } {
    if (typeof code !== 'string' || code.length > 128 || typeof publicKeySpki !== 'string' || publicKeySpki.length > 512) throw new Error('Invalid pairing request.');
    const key = createPublicKey({ key: Buffer.from(publicKeySpki, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('P-256 device key required.');
    const hash = createHash('sha256').update(code).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const match = this.db.prepare('SELECT hash,expires FROM pairing WHERE hash=?').get(hash) as { hash: string; expires: number } | undefined;
      if (!match || match.expires < now || !timingSafeEqual(Buffer.from(hash), Buffer.from(match.hash))) throw new PairingCodeError();
      const deviceId = randomUUID();
      this.db.prepare('DELETE FROM pairing WHERE hash=?').run(hash);
      this.db.prepare('INSERT INTO devices(id,public_key) VALUES(?,?)').run(deviceId, publicKeySpki);
      this.db.exec('COMMIT');
      return { deviceId, serverId: this.serverId };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  verify(proof: AuthProof, consume = true, now = Date.now()): string {
    const e = proof?.envelope;
    if (!e || typeof e.deviceId !== 'string' || !Number.isSafeInteger(e.timestamp) || Math.abs(now - e.timestamp) > 30_000 || typeof e.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(e.nonce) || !['GET','POST','PATCH'].includes(proof.method) || !/^\/v[12]\//.test(proof.path) || proof.path.includes('\n') || typeof proof.body !== 'string' || proof.body.length > 32768 || typeof e.signature !== 'string' || e.signature.length > 128) throw new Error('Invalid authentication.');
    const device = this.db.prepare('SELECT public_key,revoked FROM devices WHERE id=?').get(e.deviceId) as { public_key: string; revoked: number } | undefined;
    if (!device || device.revoked) throw new Error('Device is not authorized.');
    const signature = Buffer.from(e.signature, 'base64');
    if (signature.length !== 64 || !verify('sha256', Buffer.from(authMessage(this.serverId, proof)), { key: createPublicKey({ key: Buffer.from(device.public_key, 'base64'), format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Invalid authentication.');
    if (consume) {
      this.db.prepare('DELETE FROM nonces WHERE at < ?').run(now - 60_000);
      try { this.db.prepare('INSERT INTO nonces VALUES(?,?)').run(`${e.deviceId}:${e.nonce}`, now); } catch { throw new Error('Request replay rejected.'); }
    }
    return e.deviceId;
  }
  revoke(deviceId: string): void { this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(deviceId); }
  isActive(deviceId: string): boolean { return !!this.db.prepare('SELECT id FROM devices WHERE id=? AND revoked=0').get(deviceId); }
  close(): void { this.db.close(); }
}
