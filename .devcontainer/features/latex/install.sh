#!/usr/bin/env bash
set -euo pipefail

# Install the LaTeX toolchain
apt-get update && apt-get install -y --no-install-recommends \
  biber \
  latexmk \
  texlive-bibtex-extra \
  texlive-fonts-recommended \
  texlive-latex-extra
rm -rf /var/lib/apt/lists/*
