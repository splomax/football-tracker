// ESPN's scoreboard for each league. No browser APIs, so the Worker's backend (worker/hub.js) shares it with the page.

export const LEAGUES = {
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  cfb: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300",
};
