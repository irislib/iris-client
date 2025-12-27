# Docker Development Environment

## Setup

1. (Optional) For environment variables, create .env file and add to docker-compose.yml:

```bash
# .env file (gitignored)
CLAUDE_API_KEY=your_key_here
```

Then add to docker-compose.yml under the service:

```yaml
env_file:
  - .env
```

2. Copy your nvim config:

```bash
cp -r ~/.config/nvim ./nvim-config
```

3. Build and run in background:

```bash
docker-compose up -d --build

# Or use a different host port if 5173 is in use:
PORT=5174 docker-compose up -d --build
```

4. Enter container:

```bash
docker-compose exec iris-dev bash

# Or with zsh if you prefer:
docker-compose exec iris-dev zsh
```

## Available Commands

Inside container:

- `pnpm dev` - Run development server
- `pnpm test` - Run Playwright tests
- `pnpm lint` - Run linter
- `nvim` - Neovim with your config
- `claude` - Claude CLI (auto-aliased with --dangerously-skip-permissions)

## Syncing Changes Without GitHub

### Using Git Patches

Export changes from container:

```bash
# Inside container - create patch of uncommitted changes
git diff > /tmp/changes.patch

# From host - copy patch out
docker cp $(docker-compose ps -q iris-dev):/tmp/changes.patch ./changes.patch

# Apply patch on host
git apply changes.patch
```

### Quick commands

Add to your ~/.zshrc:

```zsh
# Extract patch from docker (uncommitted changes)
iris-patch-out() {
  local project=${1:+-p $1}
  docker exec $(docker-compose $project ps -q iris-dev) sh -c "cd /home/developer/iris-client && git diff" > ./changes.patch && \
  echo "Patch saved to ./changes.patch"
}

# Apply patch in docker
iris-patch-in() {
  local project=${1:+-p $1}
  docker cp ./changes.patch $(docker-compose $project ps -q iris-dev):/tmp/changes.patch && \
  docker exec $(docker-compose $project ps -q iris-dev) sh -c "cd /home/developer/iris-client && git apply /tmp/changes.patch"
}

# Pull latest commit(s) from docker and apply to host
iris-commit-pull() {
  local project=""
  local n=1

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      -n) n=$2; shift 2;;
      *) project="-p $1"; shift;;
    esac
  done

  docker exec $(docker-compose $project ps -q iris-dev) sh -c "cd /home/developer/iris-client && git format-patch HEAD~$n --stdout" | git am
}

# Usage:
# iris-commit-pull                # pull 1 commit from default project
# iris-commit-pull iris2          # pull 1 commit from iris2 project
# iris-commit-pull -n 3           # pull 3 commits from default project
# iris-commit-pull iris2 -n 2     # pull 2 commits from iris2 project
```
