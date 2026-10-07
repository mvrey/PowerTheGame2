import { VIEWERS, viewerFor } from '../games/viewers';
import { Replay } from '../platform/core/replay';
import { LiveStatus } from '../platform/core/tournament/types';
import { h } from '../platform/web/dom';
import { loadJson, readJsonFile } from './load';
import { ReplayPlayer } from './player';
import { TournamentScreen } from './tournament';
import './viewer.css';

// The spectator viewer. Query parameters:
//   ?replay=<url>           one match
//   ?tournament=<url>       a tournament's live.json (standings, bracket, results, any match)
//   &broadcast=1            stream layout: plays the matches by itself (point OBS at it)
//     &show=highlights|all  free-for-alls and playoff only (default), or every match
//     &from=start|now       from the first result (default: curated replays), or only new ones (live)
//   &speed=2  &lang=en|es  &sound=1

const params = new URLSearchParams(location.search);
const speed = Number(params.get('speed') ?? 2) || 2;
const broadcast = params.get('broadcast') === '1';
const app = document.getElementById('app')!;
if (broadcast) document.body.classList.add('broadcast');
for (const viewer of VIEWERS) {
  viewer.setLanguage?.(params.get('lang') ?? 'en');
  viewer.setSound?.(params.get('sound') === '1');
}

function showReplay(replay: Replay): void {
  const plugin = viewerFor(replay.game.id);
  if (!plugin) {
    app.replaceChildren(h('p.error', null, `No viewer for the game "${replay.game.id}".`));
    return;
  }
  const player = new ReplayPlayer(replay, plugin, {
    speed,
    autoplay: broadcast || params.get('autoplay') === '1',
    broadcast,
  });
  window.addEventListener('keydown', (e) => player.key(e));
  app.replaceChildren(player.el);
}

function showTournament(url: string): void {
  const screen = new TournamentScreen(url, {
    broadcast,
    speed,
    viewerFor,
    fromNow: params.get('from') === 'now',
    show: params.get('show') === 'all' ? 'all' : 'highlights',
  });
  app.replaceChildren(screen.el);
  void screen.start();
}

/** With nothing to show: pick or drop a replay. */
function landing(): void {
  const open = async (file: File | undefined) => {
    if (!file) return;
    const data = await readJsonFile<Replay | LiveStatus>(file);
    if ('format' in data) showReplay(data);
    else
      app.replaceChildren(
        h('p.error', null, 'Tournaments are watched through the server: npm run jam -- serve <tournament folder>'),
      );
  };
  const input = h('input', { type: 'file', accept: '.json', onchange: () => void open(input.files?.[0]) });
  const zone = h(
    'div.landing',
    null,
    h('h1', null, 'Bot Jam viewer'),
    h('p', null, 'Drop a replay (.json) here, or pick one: ', input),
    h('p.muted', null, 'Tournaments: npm run jam -- serve <tournament folder>'),
  );
  zone.addEventListener('dragover', (e) => e.preventDefault());
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    void open(e.dataTransfer?.files[0]);
  });
  app.replaceChildren(zone);
}

const replayUrl = params.get('replay');
const tournamentUrl = params.get('tournament');
if (replayUrl)
  loadJson<Replay>(replayUrl).then(showReplay, (error) => app.replaceChildren(h('p.error', null, String(error))));
else if (tournamentUrl) showTournament(tournamentUrl);
else landing();
