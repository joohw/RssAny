#!/usr/bin/env bash
# Usage:
#   ./scripts/docker-build.sh              # builds rssany:latest
#   ./scripts/docker-build.sh 1.0.0        # builds rssany:1.0.0
#   IMAGE_NAME=myrepo/rssany ./scripts/docker-build.sh 1.0.0

set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-rssany}"
TAG="${1:-latest}"
FULL_IMAGE="${IMAGE_NAME}:${TAG}"

# Always run from project root regardless of where the script is called from
cd "$(dirname "$0")/.."

echo "▶ Building Docker image: ${FULL_IMAGE}"
echo ""

docker build \
  --tag "${FULL_IMAGE}" \
  --file Dockerfile \
  .

echo ""
echo "✓ Build complete: ${FULL_IMAGE}"
echo ""
echo "Run the container:"
echo ""
echo "  docker run -d \\"
echo "    --name rssany \\"
echo "    -p 3751:3751 \\"
echo "    -v \"\$(pwd)/.rssany:/app/.rssany\" \\"
echo "    ${FULL_IMAGE}"
echo ""
echo "Environment variables (pass with -e):"
echo "  PORT              Server port (default: 3751)"
echo "  CHROME_PATH       Path to Chromium executable (default: /usr/bin/chromium)"
echo "  HTTP_PROXY        Proxy for outbound requests"
echo "  OPENAI_API_KEY    OpenAI API key (for LLM parser/extractor)"
echo "  OPENAI_BASE_URL   OpenAI API base URL"
echo "  OPENAI_MODEL      OpenAI model name"
echo "  TUNNEL            Set to '0' to disable Cloudflare tunnel"
