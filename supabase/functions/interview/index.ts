// POST interview -> the next question, or the finished preferences and shortlists.
import { createCourseSource, restConfigFromRequest } from "../_shared/courses.ts";
import { json, readJson, serve, SOURCE_HEADER } from "../_shared/http.ts";
import { runInterview } from "../_shared/interview.ts";
import { createModelClient } from "../_shared/model.ts";
import { InterviewRequestSchema } from "../_shared/types.ts";

Deno.serve(serve("POST", async (req) => {
  const body = await readJson(req, InterviewRequestSchema);
  const result = await runInterview(body, {
    model: createModelClient(),
    courses: createCourseSource(restConfigFromRequest(req)),
  });
  return json(result.body, 200, { [SOURCE_HEADER]: result.source });
}));
