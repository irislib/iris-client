Choose config with NODE_CONFIG_ENV: `NODE_CONFIG_ENV=iris pnpm start`

Public production profile-search defaults and the signed snapshot are tracked in
`.env.production`, so clean release worktrees do not depend on `.env.local`.
Deployment environment variables can override these public inputs.
