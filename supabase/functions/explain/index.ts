// POST explain -> { explanations: [{ id, text }] } for the top <= 10 schedules.
import { runExplain } from "../_shared/explain.ts";
import { json, readJson, serve, SOURCE_HEADER } from "../_shared/http.ts";
import { createModelClient } from "../_shared/model.ts";
import { guardModel } from "../_shared/rate-limit.ts";
import { ExplainRequestSchema } from "../_shared/types.ts";

Deno.serve(serve("POST", async (req) => {
  const body = await readJson(req, ExplainRequestSchema);
  const guard = guardModel(req, "explain", createModelClient());
  const result = await runExplain(body, guard.model);
  guard.assertAllowed();
  return json(result.body, 200, { [SOURCE_HEADER]: result.source });
}));
