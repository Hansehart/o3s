FROM mcr.microsoft.com/devcontainers/universal

# Latex suppport with common packages (paper writing)
RUN apt-get update && apt-get install -y \
  biber \
  latexmk \
  texlive-bibtex-extra \
  texlive-fonts-recommended \
  texlive-latex-extra \
  && rm -rf /var/lib/apt/lists/*

USER codespace
# UV support (efficient package manager for Python)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
