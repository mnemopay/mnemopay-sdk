# Two stages: compile TypeScript, then ship only runtime deps + the output.
#
# This used to be a single stage that did `COPY dist/ dist/`, which required the
# caller to have run `npm run build` and to have uploaded dist/. That broke:
# dist/ is in .gitignore, `railway up` honours .gitignore when deciding what to
# upload, and the build then failed with `"/dist": not found`. Adding a
# .railwayignore did not change what was uploaded.
#
# Building from source removes the dependency entirely — the image can no longer
# be built from a stale or missing dist/, and what runs in production is exactly
# what is in src/ at deploy time.

FROM node:20-slim AS build
WORKDIR /app

# Install with dev dependencies: typescript is needed to compile.
COPY package*.json ./
RUN npm ci

# tsconfig and the clean-dist helper are both required by `npm run build`.
COPY tsconfig.json ./
COPY scripts/ scripts/
COPY src/ src/
RUN npm run build

# Fail loudly here rather than at container start: a missing entrypoint is much
# cheaper to diagnose during the build than as a crash loop in production.
RUN test -f dist/mcp/server.js || (echo "build produced no dist/mcp/server.js" && exit 1)


FROM node:20-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3200

ENV PORT=3200
ENV MNEMOPAY_MODE=quick
ENV NODE_ENV=production

CMD ["node", "dist/mcp/server.js", "--start", "--http"]
