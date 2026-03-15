A restaurant allergen management platform for Cleveland. Built with Next.js, Supabase, and Vercel.

## Automatic Deployments

Pushes to the `main` branch trigger an automatic production deployment to Vercel via the `.github/workflows/deploy-vercel.yml` workflow.

### Required GitHub Secrets

Configure these secrets in **Settings → Secrets and variables → Actions** on the GitHub repository:

| Secret | How to obtain |
|---|---|
| `VERCEL_TOKEN` | [Vercel dashboard](https://vercel.com/account/tokens) → create a new token |
| `VERCEL_ORG_ID` | `.vercel/project.json` → `orgId` field (run `vercel link` locally first) |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` → `projectId` field (run `vercel link` locally first) |

Once these secrets are set, every push to `main` will automatically build and deploy the app to `clarivore.org`.
