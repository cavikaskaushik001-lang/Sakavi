#!/usr/bin/env bash
set -euo pipefail

echo "==> Building sakavi-sandbox:latest image…"
docker build -t sakavi-sandbox:latest .

echo "==> Installing Node dependencies…"
npm install

echo "==> Done."
echo ""
echo "Next:"
echo "  node examples/basic-usage.js"
echo ""
echo "Or use programmatically:"
echo "  import { createSandboxManager } from './src/index.js';"
