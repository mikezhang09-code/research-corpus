import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default Cloudflare adapter config. An R2 incremental cache can be added
// later if needed; not required for this read/manage app.
export default defineCloudflareConfig();
