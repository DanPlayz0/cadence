// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('setup generates missing Soulseek secrets and preserves configured values', async () => {
 const root=await mkdtemp(path.join(tmpdir(),'cadence-env-test-'));
 try {
  await mkdir(path.join(root,'scripts'));
  await copyFile(new URL('./setup-env.mjs',import.meta.url),path.join(root,'scripts/setup-env.mjs'));
  await writeFile(path.join(root,'.env.example'),'POSTGRES_PASSWORD=keep-existing-database-password\nSOULSEEK_PASSWORD=keep-existing-network-password\nSLSKD_API_KEY=replace-with-a-placeholder\n');
  execFileSync(process.execPath,[path.join(root,'scripts/setup-env.mjs')]);
  const first=await readFile(path.join(root,'.env'),'utf8');
  assert.match(first,/POSTGRES_PASSWORD=keep-existing-database-password/);
  assert.match(first,/SOULSEEK_PASSWORD=keep-existing-network-password/);
  assert.match(first,/SLSKD_API_KEY=[a-f0-9]{64}/);
  assert.match(first,/SLSKD_PASSWORD=[a-f0-9]{64}/);
  execFileSync(process.execPath,[path.join(root,'scripts/setup-env.mjs')]);
  assert.equal(await readFile(path.join(root,'.env'),'utf8'),first);
 } finally {
  assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
  await rm(root,{recursive:true,force:true});
 }
});
