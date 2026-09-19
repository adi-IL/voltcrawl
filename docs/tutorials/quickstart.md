# Quickstart Tutorial

Connect voltcrawl to your coding harness in under two minutes.

## Prerequisites

- Node.js version 20 or later, or Bun version 1.1 or later.
- A running Firecrawl instance. If you do not have one running, follow [How to configure self-hosted Firecrawl](../how-to/configure-self-hosted-firecrawl.md).

## Step 1: Verify the CLI binary

Run voltcrawl directly from the terminal without local installation:

```bash
npx voltcrawl --help
```

You receive usage information showing the available options and environment variables.

## Step 2: Configure your coding agent

Add voltcrawl to your agent configuration.

### OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcpServers": {
    "voltcrawl": {
      "type": "local",
      "command": ["npx", "-y", "voltcrawl"],
      "environment": {
        "FIRECRAWL_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "voltcrawl": {
      "command": "npx",
      "args": ["-y", "voltcrawl"],
      "env": {
        "FIRECRAWL_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "voltcrawl": {
      "command": "npx",
      "args": ["-y", "voltcrawl"],
      "env": {
        "FIRECRAWL_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

## Step 3: Test connection

Restart your client to establish the connection. In your agent chat prompt, type:

```
Use volt_crawl_scrape to inspect https://quotes.toscrape.com/js/
```

The agent invokes `volt_crawl_scrape` with headless Chromium and returns quotes rendered via client-side JavaScript.
