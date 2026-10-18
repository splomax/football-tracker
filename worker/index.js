// Cloudflare Worker entry point: the site and its admin API (handler.js), plus ScoreKeeper, the Durable Object that runs
// the program fetching the scores and working out the notifications (scorekeeper.js), and sends them to phones
// (phones.js). admin.js is bundled as text (see rules in wrangler.toml), not run here.

import code from "./admin.js";
import { handle, keeperFetch } from "./handler.js";

export default {
  fetch: (request, env) => handle(request, env, code),
  // Every 15 minutes (wrangler.toml), nudge the program: after a deploy nothing else would start the new code for
  // phones that are waiting on a game, and a nudge also refreshes its list of phones.
  scheduled: (event, env, ctx) => ctx.waitUntil(keeperFetch(env, "/wake")),
};

// The Durable Object behind the program: one instance, which pages and phones share (scorekeeper-object.js).
export { ScoreKeeper } from "./scorekeeper-object.js";
