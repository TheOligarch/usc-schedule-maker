// GET ai-health -> { keyPresent, model, modelOk } after one tiny model call.
import { runHealth } from "../_shared/health.ts";
import { json, serve } from "../_shared/http.ts";
import { createModelClient } from "../_shared/model.ts";

Deno.serve(serve("GET", async () => json(await runHealth(createModelClient()))));
