FROM debian:12-slim AS downloader

ARG EWP_VERSION=v1.13.2

# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL \
       https://github.com/justinwoo280/ech-workers/releases/download/${EWP_VERSION}/ewp-core-server-${EWP_VERSION}-linux-amd64 \
       -o /ewp-server \
    && chmod +x /ewp-server \
    && rm -rf /var/lib/apt/lists/*

FROM debian:12-slim

# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 65532 nonroot \
    && useradd -u 65532 -g nonroot -s /bin/false nonroot

WORKDIR /app

COPY --from=downloader --chown=nonroot:nonroot /ewp-server /app/ewp-server
COPY --chown=nonroot:nonroot entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

USER 65532

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
