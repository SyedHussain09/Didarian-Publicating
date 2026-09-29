import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
let fixtureValues = [];
try {
  const fixture = JSON.parse(await fs.readFile('docs/evidence/private/fixtures.json', 'utf8'));
  fixtureValues = fixture.users.flatMap(({ email, password }) => [email, password]).filter(Boolean);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
async function files(dir) {
  const result = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) result.push(...(await files(full)));
    else result.push(full);
  }
  return result;
}
let checked = 0;
for (const file of await files(root)) {
  if (!/\.(js|html|css|json|map)$/.test(file)) continue;
  const text = await fs.readFile(file, 'utf8');
  checked++;
  // A public SDK contains strings naming service_role; only actual credential-shaped
  // values and development fixture content are prohibited in built application files.
  if (
    /sb_secret_[A-Za-z0-9_-]{15,}|didarian-e2e-[a-z0-9-]+@|didarian-[a-z0-9]{12}-(?:authora|authorb|admin)@|SMTP_PASSWORD\s*[:=]\s*["'][^"']+["']/.test(
      text,
    ) ||
    fixtureValues.some((value) => text.includes(value))
  )
    throw new Error(`Private credential or fixture marker found in ${path.relative(root, file)}`);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    try {
      const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      if (value.role === 'service_role')
        throw new Error(`Service-role credential in ${path.relative(root, file)}`);
    } catch (error) {
      if (error.message.startsWith('Service-role')) throw error;
    }
  }
}
console.log(
  `PASS: scanned ${checked} built text assets; no backend credential-shaped values or private fixture markers found.`,
);
