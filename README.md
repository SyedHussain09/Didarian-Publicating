# Didarian Publicating

A research publication platform built with React, TypeScript and Supabase, featuring Google sign-in, author submissions and editorial review.

**Live website:** [didarian-publicating.netlify.app](https://didarian-publicating.netlify.app/)

## Local setup

Use **Node.js 24.19.0**.

```sh
git clone https://github.com/SyedHussain09/Didarian-Publicating.git
cd Didarian-Publicating
npm ci
```

Copy `.env.example` to `.env.local`. Set your Supabase URL and publishable key; keep `VITE_SITE_URL=http://127.0.0.1:5173`. Never add secret keys to frontend variables.

```sh
npm run dev
```

Open [localhost](http://127.0.0.1:5173). Google sign-in requires the matching `/auth/callback` redirect in Supabase. See [setup guidance](docs/operations.md) for backend configuration. Run `npm test` to test or `npm run build` to build.

## Developers

Developed by **Arooj Fatima** and **Syed Sajjad Hussain**.
