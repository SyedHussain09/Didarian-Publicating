# Setup notes

The README covers local frontend setup. Use a Supabase publishable key in the browser; keep OAuth client secrets and backend credentials in server-side settings.

## Existing deployment

The live website is hosted on Netlify. Updating source code in GitHub does not require resetting the database or changing account roles. The production build uses the public values listed in .env.example. For Netlify, set VITE_SITE_URL to the live HTTPS origin, build with npm run build, and publish dist. netlify.toml supplies SPA routing and security headers.

## Separate development backend

1. Create or choose a development Supabase project. Review and apply the ordered migrations in supabase/migrations exactly once, using the Supabase CLI. Never reset the existing hosted deployment.
2. Configure Google OAuth in Supabase Auth. Google's redirect URI is your project's /auth/v1/callback URL. Allow the exact frontend /auth/callback URLs in Supabase, including http://127.0.0.1:5173/auth/callback for local development.
3. Deploy the manuscripts, contact and provision-resources Edge Functions using their checked-in configuration. They validate authorization internally; retain those checks. Configure ALLOWED_ORIGINS for the intended frontend origins. For another Supabase project, update the corresponding HTTPS/WebSocket origins in netlify.toml's CSP.
4. Branded public templates are served from public/resources by Netlify. The optional Storage provisioning scripts publish the same verified assets for operators who also need a Storage copy. Private manuscript storage remains private.
5. Sign up with Google, choose Admin Author or Reviewer, and complete your profile. Admin Authors supply a name and institution; Reviewers choose a unique, case-insensitive username. The author database role is displayed as Admin Author and has no administrator privileges. Only a trusted operator can grant Admin access to an explicitly selected verified Auth user through user_roles. Existing account roles remain unchanged.

## Checks

Use npm test, npm run lint, npm run typecheck and npm run build for local checks. Browser tests require a running app and a Playwright-compatible browser. Tests that create accounts, messages or manuscripts need explicitly configured development fixtures; do not run them against production by default.

Internal setup records, account metadata, credentials and test evidence are excluded from this public source snapshot. Source code, migrations, templates and tests are included.

## Community and moderation

Anyone can read published articles. Only Reviewers can comment, like and save; they can edit/delete their own comments and undo reactions. Admins can delete any comment and remove/restore public articles with an audit reason. Admin Authors can list up to 20 contributors; names and institutions become public on publication, while contributor email addresses stay private. Activity notifications appear inside the website and never send email.

Run supabase/tests/community.sql in a trusted database test environment to verify permissions and workflow using synthetic records inside a rolled-back transaction. tests/e2e/community.spec.ts checks interfaces with intercepted responses and does not mutate production. Existing integration tests require separate explicitly supplied development accounts.

## Production domain

The site is https://ggcresearchpublishing.netlify.app. Set production VITE_SITE_URL to this exact origin before building. For a domain change, also update Supabase Auth’s Site URL and exact /auth/callback allowlist, and each Edge Function’s ALLOWED_ORIGINS. Preserve intended localhost entries and remove a retired hostname once it is no longer controlled. Google’s OAuth provider callback remains the Supabase project /auth/v1/callback URL; existing accounts, roles and manuscripts do not need migration. Users sign in again on the new browser origin.
