import { serve } from "./server.ts";
import { modelFor } from "./providers.ts";
// Pipes are the only protocol surface; raw SDK/provider errors never reach stderr.
void serve(process.stdin, process.stdout, modelFor).then(
  () => process.exit(0),
  () => process.exit(1),
);
