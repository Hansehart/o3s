FROM ubuntu:24.04@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90

# Predictable UTF-8 locale
ENV LANG=C.UTF-8

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      iproute2 \
      ca-certificates \
      curl \
      ripgrep \
      openssh-client \
  && rm -rf /var/lib/apt/lists/*

# Point runtimes with their own trust store at the system CA bundle
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

RUN mkdir -p /home/ubuntu/features /home/ubuntu/projects \
 && chown -R ubuntu:ubuntu /home/ubuntu
