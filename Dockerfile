FROM oven/bun:latest

WORKDIR /build

COPY package.json ./
COPY bun.lock ./
COPY .npmrc* .

COPY . .

EXPOSE 80/tcp
ENTRYPOINT [ "bun" ]
CMD [ "src/index.ts" ]