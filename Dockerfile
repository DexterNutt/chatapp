FROM oven/bun:latest

WORKDIR /build

COPY package.json ./
COPY bun.lockb ./
COPY .npmrc* .

COPY . .

EXPOSE 80/tcp
ENTRYPOINT [ "bun" ]
CMD [ "src/index.ts" ]