FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7

# Predictable UTF-8 locale
ENV LANG=C.UTF-8

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      iproute2 \
      less \
      openssh-client \
      vim \
  && rm -rf /var/lib/apt/lists/*

# TOML/YAML parser
COPY --from=mikefarah/yq:4.54.1@sha256:4b3d9475d65571d28cbb19544d3820ec2945e4c8b2f18279394282b8dc3a592e /usr/bin/yq /usr/local/bin/yq

# Load the markers into every interactive shell
RUN printf '\n# Export the markers the allowlist declares\nif [ -f /etc/profile.d/o3s-secrets.sh ]; then . /etc/profile.d/o3s-secrets.sh; fi\n' \
      >> /etc/bash.bashrc

# Fold the PATH prepends of every profile script into one entry per directory
COPY dedupe-path.sh /usr/local/share/o3s/dedupe-path.sh
RUN printf '\n. /usr/local/share/o3s/dedupe-path.sh\n' >> /home/ubuntu/.profile

# Point runtimes with their own trust store at the system CA bundle
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

RUN mkdir -p /home/ubuntu/features /home/ubuntu/projects \
 && chown -R ubuntu:ubuntu /home/ubuntu
