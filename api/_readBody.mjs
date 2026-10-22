// The request body as text, shared by the hosted functions, the self-hosted
// proxy and the Vite dev server.
//
// Each proxy used to build the body with `data += chunk`. That decodes every
// Buffer chunk on its own, so a multi-byte character split across two chunks
// (an emoji or any non-Latin text in an unencrypted sync file) became U+FFFD
// replacement characters, and the corrupted file was uploaded as if it were
// the user's data. Chunks are 64 KB, so it only showed once a sync file grew
// past that (#2142). The bytes are collected and decoded once, at the end.

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
