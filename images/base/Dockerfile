FROM ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea

# Predictable UTF-8 locale
ENV LANG=C.UTF-8

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      iproute2 \
      openssh-client \
      ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Point runtimes with their own trust store at the system CA bundle
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

RUN mkdir -p /home/ubuntu/features /home/ubuntu/projects \
 && chown -R ubuntu:ubuntu /home/ubuntu
