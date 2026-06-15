FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm cache clean --force \
    && for attempt in 1 2 3; do \
      npm ci --include=optional --ignore-scripts --prefer-online --no-audit --fund=false && break; \
      if [ "$attempt" = "3" ]; then exit 1; fi; \
      npm cache clean --force; \
      sleep $((attempt * 5)); \
    done \
    && npm rebuild esbuild @swc/core
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
