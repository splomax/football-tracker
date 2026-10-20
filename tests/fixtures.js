// Fake ESPN scoreboard data covering every state the app handles. Each game exists to exercise
// something specific; the comment on each one says what.

const team = (id, abbr, location, mascot, conf, color = "333333") =>
  ({ id: String(id), abbr, location, mascot, conf: conf == null ? undefined : String(conf), color });

const T = {
  OSU: team(194, "OSU", "Ohio State", "Buckeyes", 5, "ba0c2f"),
  IOWA: team(2294, "IOWA", "Iowa", "Hawkeyes", 5, "000000"),
  CAL: team(25, "CAL", "California", "Golden Bears", 1, "041e42"),
  UNLV: team(2439, "UNLV", "UNLV", "Rebels", 17, "cf0a2c"),
  WYO: team(2751, "WYO", "Wyoming", "Cowboys", 17, "492f24"),
  NDSU: team(2449, "NDSU", "North Dakota State", "Bison", 29, "0a5640"),
  BYU: team(252, "BYU", "BYU", "Cougars", 4, "0062b8"),
  TCU: team(2628, "TCU", "TCU", "Horned Frogs", 4, "4d1979"),
  VAN: team(238, "VAN", "Vanderbilt", "Commodores", 8, "000000"),
  UGA: team(61, "UGA", "Georgia", "Bulldogs", 8, "ba0c2f"),
  MD: team(120, "MD", "Maryland", "Terrapins", 5, "e03a3e"),
  PUR: team(2509, "PUR", "Purdue", "Boilermakers", 5, "000000"),
  ALA: team(333, "ALA", "Alabama", "Crimson Tide", 8, "9e1b32"),
  MSST: team(344, "MSST", "Mississippi State", "Bulldogs", 8, "5d1725"),
  ND: team(87, "ND", "Notre Dame", "Fighting Irish", 18, "062340"),
  UNC: team(153, "UNC", "North Carolina", "Tar Heels", 1, "7bafd4"),
  NE: team(17, "NE", "New England", "Patriots", null, "002244"),
  NYJ: team(20, "NYJ", "New York", "Jets", null, "115740"),
  DAL: team(6, "DAL", "Dallas", "Cowboys", null, "002a5c"),
  PHI: team(21, "PHI", "Philadelphia", "Eagles", null, "06424d"),
};

const CONF_NAMES = { 1: "ACC", 4: "Big 12", 5: "Big Ten", 8: "SEC", 17: "Mountain West" };

function competitor(t, homeAway, { score = "0", rank = 99, record } = {}, league) {
  return {
    homeAway, score, curatedRank: { current: rank },
    records: record ? [{ name: "overall", type: "total", summary: record }, { name: "Home", type: "home", summary: "2-0" }] : [],
    team: {
      id: t.id, abbreviation: t.abbr, location: t.location, name: t.mascot,
      displayName: `${t.location} ${t.mascot}`, shortDisplayName: t.location, color: t.color,
      conferenceId: t.conf,
      logo: `https://a.espncdn.com/i/teamlogos/${league === "nfl" ? "nfl" : "ncaa"}/500/${t.id}.png`,
    },
  };
}

function game({ id, league = "cfb", away, home, awayOpts, homeOpts, state, detail, statusName, clock = "0:00", period = 1,
  date = "2026-10-03T20:00Z", situation, conferenceGame = true, networks = [], recap }) {
  const comp = {
    competitors: [competitor(home, "home", homeOpts, league), competitor(away, "away", awayOpts, league)],
    situation,
    broadcasts: networks.length ? [{ market: "national", names: networks }] : [],
  };
  // ESPN only attaches the conference to conference games.
  if (league === "cfb" && conferenceGame && away.conf === home.conf && CONF_NAMES[home.conf]) {
    comp.groups = { id: home.conf, shortName: CONF_NAMES[home.conf], isConference: true };
  }
  return {
    id: String(id), date, shortName: `${away.abbr} @ ${home.abbr}`,
    status: { displayClock: clock, period, type: { name: statusName || ({ in: "STATUS_IN_PROGRESS", pre: "STATUS_SCHEDULED", post: "STATUS_FINAL" })[state], state, shortDetail: detail } },
    competitions: [comp],
    links: [{ rel: ["summary", "desktop", "event"], href: `https://www.espn.com/college-football/game/_/gameId/${id}` },
      ...(recap ? [{ rel: ["recap", "desktop", "event"], href: recap }] : [])],
  };
}

const LONG_PLAY = "(02:00) Shotgun #7 W.Howard pass short middle complete to #4 J.Smith for 9 yards to the IOWA 12, tackled by #9 S.Jones, 3RD DOWN OSU (penalty on IOWA declined)";

function cfbGames() {
  return [
    // Live, red zone, away team has the ball: field drawing, dot, glow (timeouts sent but not shown), last play popover.
    game({ id: 1, away: T.OSU, home: T.IOWA, networks: ["FOX"], awayOpts: { score: "24", rank: 5, record: "5-0" }, homeOpts: { score: "6", rank: 14, record: "3-2" },
      state: "in", detail: "2:00 - 4th", clock: "2:00", period: 4,
      situation: { possession: "194", yardLine: 12, down: 3, distance: 6, downDistanceText: "3rd & 6 at IOWA 12", isRedZone: true,
        homeTimeouts: 1, awayTimeouts: 2, lastPlay: { id: "11", text: LONG_PLAY, type: { text: "Pass Reception" }, end: { team: { id: "194" } } } } }),
    // Live right after a kickoff: ESPN omits possession; the app should fall back to the play's ending team (CAL).
    game({ id: 2, away: T.CAL, home: T.UNLV, awayOpts: { score: "7" }, homeOpts: { score: "24" }, state: "in", detail: "6:06 - 3rd", clock: "6:06", period: 3,
      conferenceGame: false,
      situation: { yardLine: 75, down: 1, distance: 10, downDistanceText: "1st & 10 at CAL 25",
        lastPlay: { id: "21", text: "UNLV kickoff for 65 yds, touchback", type: { text: "Kickoff" }, end: { team: { id: "25" } } } } }),
    // Live right after a timeout: possession omitted and the play's ending team is whoever called it, so no dot.
    // ESPN also leaves a stale isRedZone behind here; with nobody holding the ball there's no red zone.
    game({ id: 3, away: T.WYO, home: T.NDSU, awayOpts: { score: "0" }, homeOpts: { score: "20" }, state: "in", detail: "15:00 - 4th", clock: "15:00", period: 4,
      conferenceGame: false,
      situation: { yardLine: 69, down: 2, distance: 4, downDistanceText: "2nd & 4 at WYO 31", isRedZone: true,
        lastPlay: { id: "31", text: "Timeout Wyoming", type: { text: "Timeout" }, end: { team: { id: "2751" } } } } }),
    // Halftime: ESPN leaves a stale situation behind; the app should clear it and show "Half".
    game({ id: 4, away: T.BYU, home: T.TCU, awayOpts: { score: "14", rank: 10 }, homeOpts: { score: "10" }, state: "in", detail: "Halftime",
      statusName: "STATUS_HALFTIME", clock: "0:00", period: 2,
      situation: { possession: "252", yardLine: 76, downDistanceText: "2nd & 10 at BYU 24", isRedZone: false } }),
    game({ id: 5, away: T.VAN, home: T.UGA, homeOpts: { rank: 2 }, state: "pre", detail: "Sat 7:30 PM", date: "2026-10-03T23:30Z" }),
    game({ id: 6, away: T.MD, home: T.PUR, state: "pre", detail: "Sat 8:00 PM", date: "2026-10-04T00:00Z" }),
    // Final, home team lost: dark-logo team, loser greyed out.
    game({ id: 7, away: T.ALA, home: T.MSST, networks: ["CBS", "Paramount+"], awayOpts: { score: "56", rank: 7 }, homeOpts: { score: "23" }, state: "post", detail: "Final", period: 4,
      recap: "https://www.espn.com/college-football/recap/_/gameId/7" }),
    // Final: an independent (Notre Dame), for the conference list. No recap link on the scoreboard.
    game({ id: 8, away: T.ND, home: T.UNC, awayOpts: { score: "37", rank: 3 }, homeOpts: { score: "26" }, state: "post", detail: "Final", period: 4,
      conferenceGame: false }),
  ];
}

function nflGames() {
  return [
    game({ id: 101, league: "nfl", away: T.NE, home: T.NYJ, awayOpts: { score: "10" }, homeOpts: { score: "3" }, state: "in", detail: "5:00 - 2nd",
      clock: "5:00", period: 2, situation: { possession: "17", yardLine: 60, downDistanceText: "1st & 10 at NE 40", distance: 10 } }),
    game({ id: 102, league: "nfl", away: T.DAL, home: T.PHI, state: "pre", detail: "Sun 4:25 PM", date: "2026-10-04T20:25Z" }),
  ];
}

const scoreboard = (events) => ({ events });

// A 1×1 transparent PNG stands in for every logo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// ESPN's game summary, cut down to the article. Before the recap is written, the article is the preview.
const summary = (id, hasRecap) => ({
  article: hasRecap
    ? { type: "Recap", links: { web: { href: `http://www.espn.com/ncf/recap?gameId=${id}` } } }
    : { type: "Preview", links: { web: { href: `http://www.espn.com/ncf/preview?gameId=${id}` } } },
});

module.exports = { LONG_PLAY, cfbGames, nflGames, scoreboard, summary, PNG };
