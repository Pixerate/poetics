import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const UID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Mints a ULID: 48-bit millisecond timestamp then 80 random bits, Crockford base32. */
export function mintUid(now: number = Date.now(), random: Uint8Array = randomBytes(10)): string {
  if (!Number.isInteger(now) || now < 0 || now > 2 ** 48 - 1) {
    throw new RangeError(`Timestamp out of ULID range: ${now}`);
  }
  if (random.length !== 10) {
    throw new RangeError("ULID randomness must be exactly 10 bytes");
  }

  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }

  let bits = 0n;
  for (const byte of random) bits = (bits << 8n) | BigInt(byte);
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand = CROCKFORD[Number(bits & 31n)] + rand;
    bits >>= 5n;
  }

  return time + rand;
}

export function isUid(value: unknown): value is string {
  return typeof value === "string" && UID_PATTERN.test(value);
}

/** Milliseconds since the epoch encoded in a ULID. */
export function uidTime(uid: string): number {
  if (!isUid(uid)) throw new TypeError(`Not a ULID: ${uid}`);
  let t = 0;
  for (const char of uid.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(char);
  return t;
}
