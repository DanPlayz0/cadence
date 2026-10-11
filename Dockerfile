FROM node:22-bookworm-slim AS frontend
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
COPY internal/domain/playlist_icons_generated.go /src/internal/domain/playlist_icons_generated.go
RUN npm run build

FROM golang:1.26.9-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /cadence ./cmd/cadence

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 cadence && useradd -u 10001 -g cadence -M cadence \
    && mkdir -p /data /app/web /app/docs && chown cadence:cadence /data
WORKDIR /app
COPY --from=backend /cadence /usr/local/bin/cadence
COPY --from=frontend /src/web/dist /app/web/dist
COPY docs/openapi.yaml /app/docs/openapi.yaml
COPY LICENSE COPYING NOTICE THIRD_PARTY_NOTICES.md /app/
COPY GO_DEPENDENCY_NOTICES.txt web/DEPENDENCY_NOTICES.txt /app/
USER cadence
ENV LISTEN_ADDR=:6450 DATA_DIR=/data WEB_DIR=/app/web/dist MUSIC_ROOTS=/music
EXPOSE 6450
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD curl -fsS http://127.0.0.1:6450/healthz || exit 1
ENTRYPOINT ["cadence"]
