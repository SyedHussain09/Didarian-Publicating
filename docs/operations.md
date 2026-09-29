# Setup notes

The README covers local frontend setup. Use a Supabase publishable key in the browser; keep OAuth client secrets and backend credentials in server-side settings.

## Existing deployment

The live website is hosted on Netlify. Updating source code in GitHub does not require resetting the database or changing account roles. The production build uses the public values listed in .env.example. For Netlify, set VITE_SITE_URL to the live HTTPS origin, build with npm run build, and publish dist. netlify.toml supplies SPA routing and security headers.

## Separate development backend

1. Create or choose a development Supabase project. Review and apply the ordered migrations in supabase/migrations exactly once, using the Supabase CLI. Never reset the existing hosted deployment.
2. Configure Google OAuth in Supabase Auth. Google's redirect URI is your project's /auth/v1/callback URL. Allow the exact frontend /auth/callback URLs in Supabase, including http://127.0.0.1:5173/auth/callback for local development.
3. Deploy the manuscripts, contact and provision-resources Edge Functions using their checked-in configuration. They validate authorization internally; retain those checks. Configure ALLOWED_ORIGINS for the intended frontend origins. For another Supabase project, update the corresponding HTTPS/WebSocket origins in netlify.toml's CSP.
4. Provision the supplied public templates with scripts/provision-resources.mjs or scripts/upload-resources.mjs using an authorized trusted environment. Private manuscript storage remains private.
5. Sign in normally to create author accounts. An authorized operator may assign the admin role only to an explicitly selected, verified Auth user through the server-owned user_roles table. There is no public role selector.

## Checks

Use npm test, npm run lint, npm run typecheck and npm run build for local checks. Browser tests require a running app and a Playwright-compatible browser. Tests that create accounts, messages or manuscripts need explicitly configured development fixtures; do not run them against production by default.

Internal setup records, account metadata, credentials and test evidence are excluded from this public source snapshot. Source code, migrations, templates and tests are included.
