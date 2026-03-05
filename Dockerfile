FROM node:24-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build && \
    npx vsce package --allow-missing-repository
