import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

globalThis.window = globalThis.window || { addEventListener() {} };
const { _test, hashPassword } = await import('../js/auth.js');

test('https가 아닐 때 쓰는 SHA-256이 표준 결과와 같다', () => {
  for (const s of ['', 'abc', 'salt:1234', '가나다라:비밀번호', 'x'.repeat(200)]) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(_test.sha256Fallback(bytes), createHash('sha256').update(bytes).digest('hex'));
  }
});

test('hashPassword는 salt와 비밀번호를 섞어 해시한다', async () => {
  const hsh = await hashPassword('abc', '1234');
  assert.equal(hsh, createHash('sha256').update('abc:1234').digest('hex'));
});
