FROM mcr.microsoft.com/devcontainers/universal

# Remove Yarn repo if present (fix upstream GPG issues)
RUN rm -f /etc/apt/sources.list.d/yarn.list || true

# Firewall tools
RUN apt-get update && apt-get install -y \
  aggregate \
  dnsutils \
  ipset \
  && rm -rf /var/lib/apt/lists/*

# Latex suppport with common packages (paper writing)
RUN apt-get update && apt-get install -y \
  biber \
  latexmk \
  texlive-bibtex-extra \
  texlive-fonts-recommended \
  texlive-latex-extra \
  && rm -rf /var/lib/apt/lists/*

# Firewall script (run at container start via postStartCommand)
COPY firewall.sh /usr/local/bin/firewall.sh
RUN chmod 755 /usr/local/bin/firewall.sh && \
  # Restrict passwordless sudo to docker init and firewall script only (replaces blanket NOPASSWD:ALL from base image)
  sed -i 's/NOPASSWD:ALL/NOPASSWD: \/usr\/local\/share\/docker-init.sh, \/usr\/local\/bin\/firewall.sh/' /etc/sudoers.d/codespace


# Switch user
USER codespace

# UV support (efficient package manager for Python)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash
