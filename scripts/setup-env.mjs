import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
const template = fileURLToPath(new URL('../.env.example', import.meta.url));
let contents = readFileSync(existsSync(target) ? target : template, 'utf8');
let generated = 0;

for (const key of ['POSTGRES_PASSWORD', 'SETUP_TOKEN']) {
  const pattern = new RegExp(`^${key}=(.*)$`, 'm');
  const match = contents.match(pattern);
  const value = match?.[1].trim();
  if (value && !value.startsWith('replace-with-')) continue;
  const assignment = `${key}=${randomBytes(32).toString('hex')}`;
  contents = match
    ? contents.replace(pattern, () => assignment)
    : `${contents.trimEnd()}\n${assignment}\n`;
  generated++;
}

if (generated) writeFileSync(target, contents, { mode: 0o600 });
console.log(`.env ready: generated ${generated} secrets; existing configured values preserved.`);
