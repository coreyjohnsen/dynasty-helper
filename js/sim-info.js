"use strict";
/* ================= "How the simulator works" popup =================
   A long-form explanation that reads the same constants the simulation uses
   (spread by position, streaming values, bust rate), so the numbers on this
   page cannot drift from the numbers in the engine. The dialog lives on <body>,
   outside #app, so a re-render underneath it leaves it open. */
function simInfoFacts() {
  const settings = (S.league && S.league.settings) || {};
  const n = S.teams.length;
  const playoffTeams = Math.min(settings.playoff_teams || 6, n);
  const pow2 = 1 << Math.ceil(Math.log2(Math.max(2, playoffTeams)));
  const first = Math.min(S.lastWeek + 1, S.regEnd);
  return {
    n, playoffTeams, byes: pow2 - playoffTeams, regEnd: S.regEnd, lastWeek: S.lastWeek, first,
    over: S.lastWeek >= S.regEnd,
    divisions: !!(settings.divisions && S.teams.some(t => t.division))
  };
}

function simInfoSections() {
  const F = simInfoFacts();
  const p = (...c) => h('p', ...c);
  const ul = (items) => h('ul', items.map(i => h('li', i)));
  const posRows = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(k => POS_CV[k] !== undefined);
  const spread = h('div.si-table', { role: 'table', 'aria-label': 'Spread by position' },
    h('div.si-tr.si-th', { role: 'row' }, h('span', 'Position'), h('span', 'Spread (per game)'), h('span', 'Waiver-level fill-in')),
    posRows.map(k => h('div.si-tr', { role: 'row' },
      h('b', k),
      h('span.mono', POS_CV[k].toFixed(2) + ' × projection + 1.15'),
      h('span.mono', h('i.si-pre', 'fill-in '), STREAM[k] !== undefined ? STREAM[k].toFixed(1) + ' pts' : 'n/a'))));

  const here = h('div.si-here',
    h('div.si-here-h', 'In your league right now'),
    ul([
      [h('b', String(F.n)), ' teams, ', h('b', String(F.playoffTeams)), ' make the playoffs'
        + (F.byes > 0 ? ', so the top ' + F.byes + (F.byes === 1 ? ' seed gets' : ' seeds get') + ' a first-round bye.' : ', with no byes.')],
      F.over
        ? ['The regular season (through week ' + F.regEnd + ') is over, so only the playoff bracket is simulated.']
        : ['Weeks 1 to ' + F.lastWeek + ' are real results and are locked in. Simulation starts at ', h('b', 'week ' + F.first), ' and runs through week ' + F.regEnd + ', then the bracket.'],
      F.divisions ? ['Your league uses divisions, so division winners are seeded ahead of everyone else.'] : null,
      ['Injury return dates are ', h('b', INJ.enabled() ? 'on' : 'off'), ' (change this in settings). ' + (INJ.enabled()
        ? 'Hurt players are discounted by their estimated chance of playing each week.'
        : 'Anyone tagged Out or on IR is projected at zero for the rest of the season.')],
      HYP.on ? [h('b', 'Hypothetical changes are active'), ', so teams are simulated with the rosters you changed. Weeks already played stay as they were.'] : null
    ].filter(Boolean))
  );

  return [
    { id: 'idea', t: 'The short version', body: [
      p('A simulation plays out the rest of your season one time, with luck included. Every team starts the best lineup it can from its roster, each player scores a random number of points centered on his projection, the higher score wins each game, and the playoff bracket is played out the same way.'),
      p('Then it does that thousands of times. If a team makes the playoffs in 1,300 of 2,000 runs, the page says 65%. Nothing is predicted. Every percentage on the page is just a count of how often something happened across the runs.'),
      here
    ] },
    { id: 'inputs', t: 'What goes in', body: [
      p(h('b', 'Locked results. '), 'Games already played are facts. Each team keeps its real record and its real points, and the simulation only plays what is left. If a week is in progress, the finished games are banked as they happened and only the players who have not played yet are sampled.'),
      p(h('b', 'Projections. '), 'Every player has a projected score for every remaining week. These come from Sleeper\'s weekly projections (Rotowire), scored with your league\'s own scoring settings, so custom scoring, TE premium and 6-point passing touchdowns are all counted. A bye week projects as zero. When Sleeper has no projection for a player, the number is estimated from his market value and positional rank, adjusted for your scoring.'),
      p(h('b', 'Injuries. '), 'With injury return dates on, a hurt player is projected at his projection multiplied by the chance he plays that week. Short-term tags (Questionable, Doubtful) only affect this week and next. Longer injuries use an estimated return week, with a small extra discount for a first game back. Players in IR slots who should be back by a given week are moved into the lineup for it. With the setting off, an Out or IR tag means zero for the rest of the season.'),
      p(h('b', 'Lineups. '), 'For every simulated week, each team starts the best lineup its roster can field under that week\'s projections, including flex and superflex slots. A player on bye is replaced by the next best option. If a slot would still be empty, a waiver-level fill-in is used instead, because real managers stream a player rather than leave a hole. Taxi squad and IR players do not start.')
    ] },
    { id: 'score', t: 'How a score is drawn', body: [
      p('A projection is an average, not a promise. For each starter the simulation draws one score from a distribution built around his projection. How wide that distribution is depends on the position, because a kicker or quarterback is steadier than a wide receiver who lives on big plays:'),
      spread,
      p('Scores are drawn from a gamma distribution rather than a bell curve. Fantasy scoring is skewed. A player cannot score below zero, but he can score far above his average. A bell curve gets both wrong: it hands out too many near-zero games and not enough blowups. The gamma shape keeps the floor at zero and the long upper tail.'),
      p(h('b', 'Example. '), 'A receiver projected for 15 points has a spread of about 9.9. Across many draws, his median game is about 13 points, 4 in 5 of his games land between roughly 4.5 and 28, and about 1 game in 100 clears 45. The median sits below the 15 average because the big weeks pull the average up.'),
      p(h('b', 'Busts. '), 'Each starter also has a ' + (BUST_RATE * 100).toFixed(1) + '% chance each week of scoring nothing at all, covering the player who is a surprise inactive or leaves the game early.'),
      p(h('b', 'Team swing. '), 'After the starters are added up, the team total is multiplied by a factor around 1 with a standard deviation of 5%. This represents things that move a whole lineup at once, like a high-scoring slate or bad weather, so teams are not perfectly independent sums of independent players. The total is never allowed below zero.')
    ] },
    { id: 'season', t: 'Playing the season', body: [
      p('Each remaining week, every team draws a score, and the real schedule decides who plays whom. The higher score gets the win. An exact tie counts as half a win for each side. Wins and points pile on top of the record each team already has.'),
      p('After the last regular season week, teams are ranked by wins, with total points as the tiebreaker. ' + (F.divisions ? 'Division winners are moved to the top of the order first. ' : '') + 'The top ' + F.playoffTeams + ' make the bracket.'),
      p(h('b', 'The bracket. '), 'Each round pairs the best remaining seed with the worst remaining one, the next best with the next worst, and so on. When the field is not a power of two, the top seeds skip the first round. Every playoff game is a fresh draw of both teams\' scores, with no home-field advantage. The last team standing is the champion.'),
      p(h('b', 'Draft order. '), 'The draft card applies the usual rule for next year\'s rookie draft. Teams that missed the playoffs pick first, worst scoring first. Playoff teams follow in the order they were knocked out, with the champion last.')
    ] },
    { id: 'numbers', t: 'Where the numbers come from', body: [
      ul([
        [h('b', 'Playoffs, Bye, Final, Title. '), 'The share of runs where the team made the field, earned a bye, reached the title game, or won it.'],
        [h('b', 'Proj W and Proj PF. '), 'Average wins and average points scored over all runs, including the part of the season already played.'],
        [h('b', 'Avg seed and seed range. '), 'The average finishing position, and the best and worst seed the team landed in across every run.'],
        [h('b', 'Final win total. '), 'A count of how many runs ended on each win total for the selected team.'],
        [h('b', 'Biggest game left. '), 'The same runs, split by who won a given game. The difference in playoff odds between "wins" and "loses" is the swing. No extra simulations are needed, because every run already recorded who won each remaining game.'],
        [h('b', 'Schedule luck. '), 'In every simulated week the simulation also counts how many teams each team would have beaten. Comparing that all-play record with the wins its real schedule produced shows who has the kinder schedule.'],
        [h('b', 'Win-total and seed charts, still-alive tracking. '), 'More of the same counting, sliced by week or by outcome. The "still alive" line is an approximation, since it only asks whether a team could reach the cut line on wins alone.']
      ])
    ] },
    { id: 'modes', t: 'The three modes', body: [
      ul([
        [h('b', 'Season odds. '), 'The full simulation described above, repeated for the number of runs you choose.'],
        [h('b', 'Single week. '), 'Plays only the chosen week. You get each matchup\'s win chances and the range each team\'s score is likely to land in. Nothing after that week is simulated.'],
        [h('b', 'Play a season. '), 'Plays one season as a single run, game by game from the first unplayed week, through the bracket to a champion, so you can watch how a season can go. Weeks already played keep their real results. The season number shown under the button identifies it.']
      ])
    ] },
    { id: 'runs', t: 'How many runs, and how exact', body: [
      p('More runs make the percentages steadier, not smarter. The run-to-run wobble in a percentage is roughly the square root of p × (1 − p) ÷ runs. For a team that is truly at 50%, 2,000 runs put the reading within about 2 points of the real value 95% of the time, and 10,000 runs within about 1 point. Small odds are even tighter in absolute terms: a team near 2% moves by only a few tenths.'),
      p('Every batch of runs starts from a fresh random seed, so the same settings will give slightly different numbers each time. If two results differ by a point or two, treat them as the same.'),
      p('The runs happen in a background thread, so the page stays responsive while they play out.')
    ] },
    { id: 'limits', t: 'What it does not know', body: [
      ul([
        'Rosters are frozen. Nobody makes trades, picks up free agents or drops players, apart from the fill-in for an empty slot. Real managers will change their teams, which a simulation cannot see.',
        'Every manager starts the optimal lineup every week. Real managers sometimes sit the wrong player, so the real spread between teams is a little wider than shown.',
        'The centers of the distributions are the projections. If a projection is off, every number built on it is off in the same direction. The simulation adds the randomness; it does not correct the average.',
        'Spread is set by position, not by player. A boom-or-bust receiver and a steady one with the same projection are treated alike.',
        'Players are mostly independent. The team swing links a lineup together, but a quarterback and his receiver do not rise and fall together game by game.',
        'Injuries come only from the tags Sleeper and the injury feed publish, plus the small bust chance. A healthy player is not expected to get hurt later in the season.',
        'It gives odds, not predictions. A 10% title chance is a real outcome one season in ten.'
      ])
    ] }
  ];
}

function openSimInfo() {
  if (document.querySelector('.imodal-back')) return;
  const prev = document.activeElement;
  const sections = simInfoSections();
  const scroller = h('div.imodal-body', { tabindex: '-1' });
  sections.forEach(s => scroller.appendChild(h('section.si-sec', { id: 'si-' + s.id },
    h('h4', s.t), s.body)));
  const nav = h('nav.si-nav', { 'aria-label': 'Sections' }, sections.map(s =>
    h('button.si-chip', { type: 'button', onclick: () => {
      const el = scroller.querySelector('#si-' + s.id);
      if (el) scroller.scrollTo({ top: el.offsetTop - 6, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } }, s.t)));
  const closeBtn = h('button.imodal-x', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, ico('close'));
  const dlg = h('div.imodal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'si-title' },
    h('div.grab'),
    h('div.imodal-head', h('div', h('h3', { id: 'si-title' }, 'How the simulator works'),
      h('div.tiny.muted', 'Everything the engine does, in plain language')), closeBtn),
    nav, scroller);
  const back = h('div.imodal-back', { onclick: e => { if (e.target === back) close(); } }, dlg);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(dlg.querySelectorAll('button, [tabindex="-1"]')).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close);
    back.remove();
    document.body.classList.remove('imodal-open');
    // the page may have redrawn underneath, so the button that opened this can be a stale node
    const back2 = prev && prev.isConnected ? prev : document.querySelector('.siminfo');
    if (back2) { try { back2.focus(); } catch (e) { } }
  }
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close);
  document.body.classList.add('imodal-open');
  document.body.appendChild(back);
  closeBtn.focus();
}
