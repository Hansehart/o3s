FROM ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea

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

RUN mkdir -p /home/ubuntu/features /home/ubuntu/projects \
 && chown -R ubuntu:ubuntu /home/ubuntu
