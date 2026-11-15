// POST refine -> { constraints, unparsed } for one piece of results-page schedule feedback.
import { json, readJson, serve, SOURCE_HEADER } from "../_shared/http.ts";
import { createModelClient } from "../_shared/model.ts";
import { RefineRequestSchema, runRefine } from "../_shared/refine.ts";

Deno.serve(serve("POST", async (req) => {
  const body = await readJson(req, RefineRequestSchema);
  const result = await runRefine(body, createModelClient());
  return json(result.body, 200, { [SOURCE_HEADER]: result.source });
}));
