A restaurant allergen management platform for Cleveland. Built with Next.js, Supabase, and Vercel.

## Automatic Deployments

Pushes to the `main` branch trigger an automatic production deployment through the Vercel Git integration for the linked `clarivore` project.

Keep the Vercel project linked to this repository with `main` as the production branch, and keep custom-domain auto-assignment enabled so `clarivore.org` is promoted to the newest production deployment automatically.

No GitHub Actions secrets are required for the normal push-to-deploy flow.

## Manual Deploys

For a manual production deploy from this worktree, run `npm run deploy`. That path uses `scripts/deploy-vercel.sh` and stays KB-free.
