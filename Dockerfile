FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

FROM base AS runner
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/prompt ./prompt
COPY --from=builder /app/index.ts ./index.ts
COPY --from=builder /app/cli.ts ./cli.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./

RUN mkdir -p /app/data

ENV DATA_PATTERN="data/*/train-*.parquet"
ENV OUTPUT_DIR="data/results"

CMD ["bun", "run", "cli.ts", "run"]
