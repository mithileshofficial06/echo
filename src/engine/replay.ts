/** Growable per-tick input log. One byte per tick. */
export class InputLog {
  private buf = new Uint8Array(4096);
  length = 0;

  push(input: number) {
    if (this.length === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = input;
  }

  toArray(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/**
 * Run-length encode inputs as [value, count] byte pairs, then base64.
 * Input rarely changes tick-to-tick, so a full run compresses to a few KB.
 */
export function encodeInputs(inputs: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < inputs.length) {
    const v = inputs[i];
    let n = 1;
    while (i + n < inputs.length && inputs[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  let bin = "";
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeInputs(encoded: string): Uint8Array {
  const bin = atob(encoded);
  let total = 0;
  for (let i = 1; i < bin.length; i += 2) total += bin.charCodeAt(i);
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i + 1 < bin.length; i += 2) {
    const v = bin.charCodeAt(i);
    const n = bin.charCodeAt(i + 1);
    out.fill(v, o, o + n);
    o += n;
  }
  return out;
}
