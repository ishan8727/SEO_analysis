import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      HASH_SALT: "test-salt-0123456789abcdef",
      COOKIE_SECRET: "test-cookie-secret-0123456789abcdef0123456789",
      APP_URL: "http://localhost:3000",
      GOOGLE_SERVER_KEY: "test-server-key",
      DEFAULT_COUNTRY: "IN",
    },
  },
});
