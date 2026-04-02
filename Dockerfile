# Base stage with system dependencies
FROM node:20-bookworm AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    wget \
    python3 \
    python3-pip \
    build-essential \
    ripgrep \
    fd-find \
    # Terminal tools
    tmux \
    htop \
    zsh \
    vim \
    # For telescope-fzf-native
    fzf \
    # Build dependencies for Neovim
    ninja-build \
    gettext \
    libtool \
    libtool-bin \
    autoconf \
    automake \
    cmake \
    g++ \
    pkg-config \
    unzip \
    # Playwright dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libatspi2.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxcb1 \
    libxkbcommon0 \
    libgtk-3-0 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*


# Neovim build stage - cached separately
FROM base AS neovim-builder

RUN git clone https://github.com/neovim/neovim.git --depth 1 --branch v0.10.2 && \
    cd neovim && \
    make CMAKE_BUILD_TYPE=Release && \
    make install DESTDIR=/neovim-install && \
    cd .. && \
    rm -rf neovim

# Global npm tools stage
FROM base AS npm-tools

# Copy Neovim from builder stage
COPY --from=neovim-builder /neovim-install/usr/local /usr/local

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Install TypeScript language server
RUN npm install -g typescript typescript-language-server

# Install only Chromium for Playwright (smaller download)
RUN npx playwright install --with-deps chromium && \
    # Copy Playwright cache to a shared location
    cp -r /root/.cache/ms-playwright /opt/ms-playwright && \
    chmod -R 755 /opt/ms-playwright

# Final stage
FROM npm-tools AS dev

# Create developer user
RUN useradd -m -s /bin/zsh developer

# Add claude alias for both users
RUN echo 'alias claude="claude --dangerously-skip-permissions"' >> /root/.bashrc && \
    echo 'alias claude="claude --dangerously-skip-permissions"' >> /root/.zshrc && \
    echo 'alias claude="claude --dangerously-skip-permissions"' >> /home/developer/.bashrc && \
    echo 'alias claude="claude --dangerously-skip-permissions"' >> /home/developer/.zshrc

# Install hashtree git support and clone the repository as developer user
RUN curl -fsSL https://upload.iris.to/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/releases%2Fhashtree/latest/install.sh | sh -s -- /usr/local/bin && \
    git clone htree://npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/iris-client /home/developer/iris-client && \
    chown -R developer:developer /home/developer/iris-client

# Install dependencies as developer user
WORKDIR /home/developer/iris-client
USER developer
RUN yarn install --frozen-lockfile
USER root

# Copy nvim config for both users
COPY ./nvim-config /root/.config/nvim
COPY ./nvim-config /home/developer/.config/nvim
RUN chown -R developer:developer /home/developer/.config/nvim && \
    # Setup Playwright cache for developer user
    mkdir -p /home/developer/.cache && \
    ln -s /opt/ms-playwright /home/developer/.cache/ms-playwright && \
    chown -R developer:developer /home/developer/.cache


# Expose dev server port
EXPOSE 5173

# Set environment for development
ENV NODE_ENV=development

# Set default user
USER developer
WORKDIR /home/developer/iris-client

# Start dev server by default
CMD ["yarn", "dev"]
