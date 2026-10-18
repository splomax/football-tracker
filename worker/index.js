// Cloudflare Worker entry point: the site and its admin API (handler.js). admin.js is bundled as text (see rules in
// wrangler.toml), not run here.

import code from "./admin.js";
import { handle } from "./handler.js";

export default {
  fetch: (request, env) => handle(request, env, code),
};
