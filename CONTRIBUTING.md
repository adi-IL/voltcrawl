# Contributing to voltcrawl

We welcome contributions to voltcrawl.

## Development setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/adi-IL/voltcrawl.git
cd voltcrawl
bun install
```

## Running tests

Run the offline test suite:

```bash
bun test
bun run tests/stdio-test.ts
```

## Building artifacts

Compile the standalone bundles:

```bash
bun run build
```

## Submitting pull requests

- Write tests for new functionality.
- Ensure all 144 unit tests pass.
- Follow conventional commit messages.
- Adhere to the truth contract: search hits are discovery signals only, rendered DOM is the source of truth.
