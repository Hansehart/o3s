FROM ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb

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

RUN mkdir -p /home/ubuntu/config /home/ubuntu/projects \
 && chown -R ubuntu:ubuntu /home/ubuntu
