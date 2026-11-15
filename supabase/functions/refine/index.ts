// POST refine -> { constraints, unparsed } for one piece of results-page schedule feedback.
import { json, readJson, serve, SOURCE_HEADER } from "../_shared/http.ts";
import { createModelClient } from "../_shared/model.ts";
import { guardModel } from "../_shared/rate-limit.ts";
import { RefineRequestSchema, runRefine } from "../_shared/refine.ts";

Deno.serve(serve("POST", async (req) => {
  const body = await readJson(req, RefineRequestSchema);
  const guard = guardModel(req, "refine", createModelClient());
  const result = await runRefine(body, guard.model);
  guard.assertAllowed();
  return json(result.body, 200, { [SOURCE_HEADER]: result.source });
}));
