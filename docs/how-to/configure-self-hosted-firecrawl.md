# How to Configure Self-Hosted Firecrawl

Step-by-step instructions for running a local Firecrawl instance for voltcrawl.

## Option 1: Docker single container (Quickest)

To run Firecrawl locally on port 3002:

```bash
docker run -d \
  --name firecrawl \
  -p 3002:3002 \
  firecrawl/firecrawl:latest
```

Verify service availability:

```bash
curl http://localhost:3002/v0/health/readiness
```

When readiness returns HTTP 200, configure voltcrawl:

```bash
export FIRECRAWL_API_URL="http://localhost:3002"
npx voltcrawl
```

## Option 2: Docker Compose with Chromium sidecar

For full JavaScript rendering with headless Chromium:

1. Clone the Firecrawl upstream repository:
   ```bash
   git clone https://github.com/mendableai/firecrawl.git
   cd firecrawl
   ```
2. Start the core stack:
   ```bash
   docker compose up -d api playwright-service redis
   ```
3. Test a dynamic JavaScript scrape:
   ```bash
   curl -s -X POST http://localhost:3002/v2/scrape \
     -H "Content-Type: application/json" \
     -d '{"url": "https://quotes.toscrape.com/js/", "waitFor": 2500}'
   ```

## Connecting voltcrawl

Point `FIRECRAWL_API_URL` to your local instance:

```bash
export FIRECRAWL_API_URL="http://localhost:3002"
voltcrawl
```
