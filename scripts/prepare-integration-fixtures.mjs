/** Development-only fallback when Supabase SMTP prevents real signup fixtures.
 * Writes bcrypt HASHES (never plaintext passwords) to an ignored SQL script.
 * A trusted operator applies it to the designated DEV database, then all tests
 * sign in through normal Supabase Auth and exercise ordinary user JWTs.
 */
import { hash } from 'bcryptjs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const filename = 'docs/evidence/private/fixtures.json';
const fixtures = JSON.parse(await readFile(filename, 'utf8'));
if (fixtures.projectRef !== 'ygcporcsudpjfltanqpj')
  throw new Error('This fallback is authorized only for the designated development project.');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
let sql = 'begin;\n';
for (const user of fixtures.users) {
  user.id ||= randomUUID();
  const passwordHash = await hash(user.password, 12);
  const metadata = JSON.stringify({
    first_name: 'Integration',
    last_name: user.label,
    affiliation: 'Controlled development fixture',
    role: 'admin',
    integration_run: fixtures.runId,
  });
  sql += `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change) values('00000000-0000-0000-0000-000000000000',${quote(user.id)},'authenticated','authenticated',${quote(user.email)},${quote(passwordHash)},now(),'{"provider":"email","providers":["email"]}',${quote(metadata)},now(),now(),'','','','') on conflict(id) do nothing;\n`;
  sql += `insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) values(${quote(user.id)},${quote(user.id)},${quote(JSON.stringify({ sub: user.id, email: user.email, email_verified: true, phone_verified: false }))},'email',now(),now()) on conflict(provider_id,provider) do nothing;\n`;
}
const admin = fixtures.users.find((user) => user.label === 'admin');
sql += `update public.user_roles set role='admin' where user_id=${quote(admin.id)};\ncommit;\nselect id from auth.users where raw_user_meta_data->>'integration_run'=${quote(fixtures.runId)};`;
await writeFile(filename, JSON.stringify(fixtures, null, 2));
await writeFile('docs/evidence/private/bootstrap-fixtures.sql', sql);
console.log(
  JSON.stringify({
    path: 'docs/evidence/private/bootstrap-fixtures.sql',
    users: fixtures.users.map(({ label, id }) => ({ label, id })),
  }),
);
