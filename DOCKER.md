# Docker

## Building the Image

```bash
docker build -t ohtujutt-rss .
```

## Running with Docker

```bash
docker run -p 8787:8787 ohtujutt-rss
```

Access the feed at: http://localhost:8787/feed.xml

## Running with Docker Compose

```bash
docker-compose up
```

Or in detached mode:
```bash
docker-compose up -d
```

View logs:
```bash
docker-compose logs -f
```

Stop:
```bash
docker-compose down
```

## Pulling from GitHub Container Registry

```bash
docker pull ghcr.io/lnagel/ohtujutt-rss:latest
```

## Health Check

The container includes a health check that verifies the service is responding:

```bash
docker inspect --format='{{json .State.Health}}' <container-id>
```

## Multi-Architecture Support

The GitHub Actions workflow builds images for:
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

## Image Tags

Images are automatically tagged with:
- `latest` - Latest build from main branch
- `<branch-name>` - Latest build from that branch
- `<branch>-<sha>` - Specific commit
- `v1.2.3` - Semantic version tags
- `v1.2` - Minor version
- `v1` - Major version
