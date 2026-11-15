// GET ai-health -> { keyPresent, model, modelOk } after one tiny model call.
import { runHealth } from "../_shared/health.ts";
import { json, serve } from "../_shared/http.ts";
import { createModelClient } from "../_shared/model.ts";
import { guardModel } from "../_shared/rate-limit.ts";

Deno.serve(serve("GET", async (req) => {
  const guard = guardModel(req, "ai-health", createModelClient());
  const health = await runHealth(guard.model);
  guard.assertAllowed();
  return json(health);
}));
