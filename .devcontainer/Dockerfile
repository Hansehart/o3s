FROM mcr.microsoft.com/devcontainers/universal

# Remove Yarn repo if present (fix upstream GPG issues)
RUN rm -f /etc/apt/sources.list.d/yarn.list || true

# Additional tools (e.g for firewall)
RUN apt-get update && apt-get install -y \
  aggregate \
  cron \
  dnsutils \
  ipset \
  && rm -rf /var/lib/apt/lists/*

# Google Chrome (for chrome-devtools-mcp)
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | tee /etc/apt/trusted.gpg.d/google.asc >/dev/null \
  && echo "deb [arch=amd64] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update && apt-get install -y google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

# Latex suppport with common packages (paper writing)
RUN apt-get update && apt-get install -y \
  biber \
  latexmk \
  texlive-bibtex-extra \
  texlive-fonts-recommended \
  texlive-latex-extra \
  && rm -rf /var/lib/apt/lists/*

# Firewall script (runs at container start)
COPY firewall.sh /usr/local/bin/firewall.sh
RUN chmod 755 /usr/local/bin/firewall.sh
# Cron job for periodic IP refresh
COPY firewall-cron /etc/cron.d/firewall-refresh
RUN chmod 644 /etc/cron.d/firewall-refresh

# Switch user
USER codespace
# TODO: Harden sudo rights for codespace user (currently NOPASSWD:ALL from base image)
# sed -i 's/NOPASSWD:ALL/NOPASSWD: \/usr\/local\/share\/docker-init.sh, \/usr\/local\/share\/ssh-init.sh, \/usr\/local\/bin\/firewall.sh/' /etc/sudoers.d/codespace

# UV support (efficient package manager for Python)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash
# Codex
RUN npm i -g @openai/codex
