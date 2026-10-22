import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { readBody } from './_readBody.mjs';

// A request stream that delivers `bytes` in pieces cut at the given offsets.
const streamOf = (bytes, cuts) => {
  const stream = new PassThrough();
  let from = 0;
  queueMicrotask(() => {
    for (const at of [...cuts, bytes.length]) {
      stream.write(bytes.subarray(from, at));
      from = at;
    }
    stream.end();
  });
  return stream;
};

describe('readBody (#2142)', () => {
  it('keeps a multi-byte character that is split across two chunks', async () => {
    const text = JSON.stringify({ title: 'Plan 😀 — 日本語 tâche' });
    const bytes = Buffer.from(text, 'utf8');
    // Cut inside the emoji (4 bytes) and inside a CJK character (3 bytes).
    const emoji = bytes.indexOf(Buffer.from('😀'));
    const cjk = bytes.indexOf(Buffer.from('日'));
    const body = await readBody(streamOf(bytes, [emoji + 1, emoji + 3, cjk + 2]));
    expect(body).toBe(text);
    expect(body).not.toContain('�');
  });

  it('reads a sync-file-sized body intact across many chunks', async () => {
    const text = JSON.stringify({ tasks: Array.from({ length: 4000 }, (_, i) => ({ id: i, title: `tâche ${i} 🗓️` })) });
    const bytes = Buffer.from(text, 'utf8');
    const cuts = [];
    for (let at = 65_537; at < bytes.length; at += 65_537) cuts.push(at);
    expect(await readBody(streamOf(bytes, cuts))).toBe(text);
  });

  it('reads an empty body as the empty string', async () => {
    expect(await readBody(streamOf(Buffer.alloc(0), []))).toBe('');
  });
});

describe('the self-hosted image', () => {
  it('copies every api/ module the proxy imports', () => {
    const proxy = readFileSync(new URL('../docker/proxy-server.mjs', import.meta.url), 'utf8');
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    const imports = [...proxy.matchAll(/from '\.\.\/(api\/[^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const path of imports) expect(dockerfile).toContain(`COPY ${path} /app/${path}`);
  });
});
