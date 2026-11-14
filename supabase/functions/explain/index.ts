// POST explain -> { explanations: [{ id, text }] } for the top <= 10 schedules.
import { runExplain } from "../_shared/explain.ts";
import { json, readJson, serve, SOURCE_HEADER } from "../_shared/http.ts";
import { createModelClient } from "../_shared/model.ts";
import { ExplainRequestSchema } from "../_shared/types.ts";

Deno.serve(serve("POST", async (req) => {
  const body = await readJson(req, ExplainRequestSchema);
  const result = await runExplain(body, createModelClient());
  return json(result.body, 200, { [SOURCE_HEADER]: result.source });
}));
