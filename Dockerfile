FROM node:20-bookworm-slim

WORKDIR /app/backend

# Build tools needed for sqlite3 native module on platforms without prebuilds
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm install --production

COPY backend/src ./src

# Persist the SQLite DB on a mounted volume in production
VOLUME ["/app/backend/data"]

ENV PORT=4000
EXPOSE 4000

# Seed only if the DB doesn't already exist, then start
CMD sh -c "test -f data/expenses.sqlite || npm run seed; npm start"
