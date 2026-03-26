FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc
EXPOSE 3099
CMD ["node", "dist/index.js"]
