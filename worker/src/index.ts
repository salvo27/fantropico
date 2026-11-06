import { handleRequest, type AppDeps } from "./app";
import { createAnthropicProvider } from "./llm/anthropic";
import { adminRoutes } from "./routes/admin";
import { memberRoutes } from "./routes/member";
import { publicRoutes } from "./routes/public";
import { cleanupOldData } from "./usage/cleanup";

export const routes = [...publicRoutes, ...memberRoutes, ...adminRoutes];

const deps: AppDeps = {
  llm: (apiKey) => createAnthropicProvider(apiKey),
  now: () => new Date(),
};

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env, deps, routes);
  },
  scheduled(_controller, env, ctx): void {
    ctx.waitUntil(cleanupOldData(env.DB, new Date()));
  },
} satisfies ExportedHandler<Env>;
