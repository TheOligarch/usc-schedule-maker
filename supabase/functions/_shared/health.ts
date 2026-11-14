import { ModelClient, ModelError } from "./model.ts";

export interface HealthResponse {
  keyPresent: boolean;
  model: string;
  modelOk: boolean;
  /** Present only when modelOk is false: the provider's error, never the key. */
  error?: string;
}

export async function runHealth(model: ModelClient): Promise<HealthResponse> {
  const base = { keyPresent: model.keyPresent, model: model.model };
  if (!model.keyPresent) {
    return { ...base, modelOk: false, error: "missing_key: ANTHROPIC_API_KEY is not set" };
  }
  try {
    await model.ping();
    return { ...base, modelOk: true };
  } catch (err) {
    const e = err instanceof ModelError ? err : new ModelError("unexpected_error", "model call failed");
    return { ...base, modelOk: false, error: `${e.code}${e.status ? ` (${e.status})` : ""}: ${e.message}` };
  }
}
