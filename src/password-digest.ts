import { pbkdf2Sync } from 'node:crypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

// Both implementations derive exactly the same bytes for stored CIV credentials.
export function derivePassword(password:string,salt:string,iterations:310000|600000,native=pbkdf2Sync){
 try {
  return native(password,salt,iterations,32,'sha256');
 } catch {
  const utf8=new TextEncoder();
  return pbkdf2(sha256,utf8.encode(password),utf8.encode(salt),{c:iterations,dkLen:32});
 }
}
