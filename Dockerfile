FROM node:22-slim AS builder

WORKDIR /app

# ネイティブモジュールのビルドに必要
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:22-slim AS runner

WORKDIR /app

# データディレクトリを作成
RUN mkdir -p /app/data && chown -R mcp:mcp /app

COPY package*.json ./

# 本番用依存関係のみインストール（--omit=devが現在の推奨）
RUN npm ci --omit=dev

# ビルド成果物をコピー
COPY --from=builder --chown=mcp:mcp /app/dist ./dist
COPY --from=builder --chown=mcp:mcp /app/resources ./resources

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/main.ts"]