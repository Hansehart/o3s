# https://github.com/devcontainers/images/tree/main/src/universal
FROM mcr.microsoft.com/devcontainers/universal

# Remove Yarn repo if present (fix upstream GPG issues)
RUN rm -f /etc/apt/sources.list.d/yarn.list || true

# Additional tools
RUN apt-get update && apt-get install -y \
  ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Browser MCP
ARG INSTALL_CHROME=false
RUN if [ "$INSTALL_CHROME" = "true" ]; then \
  wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | tee /etc/apt/trusted.gpg.d/google.asc >/dev/null \
  && echo "deb [arch=amd64] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update && apt-get install -y google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*; fi

# Paper Writing
ARG INSTALL_LATEX=false
RUN if [ "$INSTALL_LATEX" = "true" ]; then \
  apt-get update && apt-get install -y \
  biber \
  latexmk \
  texlive-bibtex-extra \
  texlive-fonts-recommended \
  texlive-latex-extra \
  && rm -rf /var/lib/apt/lists/*; fi

# Switch user
USER codespace
# TODO: Harden sudo rights for codespace user (currently NOPASSWD:ALL from base image)
# sed -i 's/NOPASSWD:ALL/NOPASSWD: \/usr\/local\/share\/docker-init.sh, \/usr\/local\/share\/ssh-init.sh, \/sbin\/ip/' /etc/sudoers.d/codespace

# Python Package Manager
ARG INSTALL_UV=false
RUN if [ "$INSTALL_UV" = "true" ]; then curl -LsSf https://astral.sh/uv/install.sh | sh; fi

# Claude Code CLI
ARG INSTALL_CLAUDE=true
RUN if [ "$INSTALL_CLAUDE" = "true" ]; then curl -fsSL https://claude.ai/install.sh | bash; fi

# Codex CLI
ARG INSTALL_CODEX=false
RUN if [ "$INSTALL_CODEX" = "true" ]; then npm i -g @openai/codex; fi
