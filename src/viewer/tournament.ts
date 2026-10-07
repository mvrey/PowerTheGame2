import { Replay } from '../platform/core/replay';
import { FixtureResult, GroupState, LiveStatus, TieState } from '../platform/core/tournament/types';
import { ViewerPlugin } from '../platform/core/viewer';
import { h, wait } from '../platform/web/dom';
import { loadJson } from './load';
import { ReplayPlayer } from './player';

export interface TournamentOptions {
  /** Broadcast mode: plays the matches by itself, for OBS. */
  broadcast: boolean;
  /** Broadcast only the results that arrive from now on (a live stream), not those already played. */
  fromNow: boolean;
  /** Broadcast every match, or only the highlights: free-for-alls, the playoff and the exhibition. */
  show: 'all' | 'highlights';
  speed: number;
  viewerFor(gameId: string): ViewerPlugin | undefined;
}

const POLL_MS = 4000;
const RESULT_CARD_MS = 6000;
const TABLES_MS = 10000;

/**
 * A tournament as it stands: group tables, the bracket, the latest results, and any match on
 * demand. It reads the live status the tournament runner publishes and never computes a result.
 */
export class TournamentScreen {
  readonly el = h('div.tournament');
  private status: LiveStatus | null = null;
  private player: ReplayPlayer | null = null;
  private overlay: HTMLElement | null = null;
  /** Results already broadcast, or skipped. */
  private shown = new Set<string>();

  constructor(
    private readonly url: string,
    private readonly options: TournamentOptions,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeReplay();
      else this.player?.key(e);
    });
  }

  async start(): Promise<void> {
    await this.refresh();
    if (this.options.fromNow) this.status?.results.forEach((r) => this.shown.add(r.fixtureId));
    window.setInterval(() => void this.refresh(), POLL_MS);
    if (this.options.broadcast) void this.direct();
  }

  private async refresh(): Promise<void> {
    try {
      const status = await loadJson<LiveStatus>(this.url);
      if (this.status && status.updatedAt === this.status.updatedAt) return;
      this.status = status;
      this.render();
    } catch (error) {
      this.el.replaceChildren(
        h('p.error', null, `Cannot read ${this.url}: ${error instanceof Error ? error.message : error}`),
      );
    }
  }

  /** Broadcast: each result in the order it came, played in full, then its result card; the tables in between. */
  private async direct(): Promise<void> {
    for (;;) {
      const next = this.status?.results.find((r) => !this.shown.has(r.fixtureId) && this.worthShowing(r));
      if (!next) {
        await wait(TABLES_MS);
        continue;
      }
      this.shown.add(next.fixtureId);
      const finished = await this.openReplay(next, true);
      if (finished) await wait(RESULT_CARD_MS);
      this.closeReplay();
    }
  }

  private worthShowing(result: FixtureResult): boolean {
    if (this.options.show === 'all') return true;
    const fixture = this.status?.plan.fixtures.find((f) => f.id === result.fixtureId);
    return !!fixture && (fixture.kind === 'ffa' || fixture.stage !== 'group');
  }

  private name(id: string | null): string {
    if (id === null) return '—';
    return this.status?.record.entrants.find((e) => e.id === id)?.name ?? id;
  }

  private render(): void {
    const status = this.status!;
    const { record, plan } = status;
    const done = plan.ranking !== null;
    this.el.replaceChildren(
      h(
        'header.t-head',
        null,
        h('h1', null, record.title),
        h(
          'span.t-meta',
          null,
          `${record.game.id} ${record.game.version} · ${record.entrants.length} bots · ` +
            `${status.results.length} matches played · ${plan.pending.length} to play`,
        ),
        status.running.length ? h('span.live', null, '● LIVE') : done ? h('span.final', null, 'FINAL') : null,
      ),
      h(
        'div.t-body',
        null,
        h('section.t-groups', null, h('h2', null, 'Groups'), ...plan.groups.map((g) => this.groupTable(g))),
        h(
          'section.t-bracket',
          null,
          h('h2', null, 'Playoff'),
          plan.playoff ? this.bracket(plan.playoff) : h('p.muted', null, 'After the groups.'),
          done ? this.podium(plan.ranking!) : null,
        ),
        h('section.t-results', null, h('h2', null, 'Results'), this.results(status)),
      ),
    );
  }

  private groupTable(group: GroupState): HTMLElement {
    const head = ['', 'Bot', 'P', 'W', 'D', 'L', 'FFA', '±', 'Pts'];
    return h(
      'table.group',
      null,
      h('caption', null, `Group ${group.name}`, group.complete ? '' : ' · playing'),
      h('thead', null, h('tr', null, ...head.map((c) => h('th', null, c)))),
      h(
        'tbody',
        null,
        ...group.standings.map((row, i) =>
          h(
            'tr',
            { class: i < this.status!.record.config.qualifiersPerGroup && group.complete ? 'through' : '' },
            h('td', null, i + 1),
            h('td.bot', null, this.name(row.id)),
            h('td', null, row.played),
            h('td', null, row.won),
            h('td', null, row.drawn),
            h('td', null, row.lost),
            h('td', null, row.ffaPoints),
            h('td', null, row.material),
            h('td.pts', null, row.points),
          ),
        ),
      ),
    );
  }

  private bracket(playoff: NonNullable<LiveStatus['plan']['playoff']>): HTMLElement {
    const tie = (t: TieState) =>
      h(
        'div.tie',
        { class: t.winner ? 'decided' : '' },
        h('div.tie-id', null, t.id),
        ...(
          [
            [t.a, t.score[0]],
            [t.b, t.score[1]],
          ] as const
        ).map(([id, score]) =>
          h(
            'div.tie-row',
            { class: t.winner && t.winner === id ? 'won' : '' },
            h('span', null, this.name(id)),
            h('b', null, score),
          ),
        ),
        t.decidedBy && t.decidedBy !== 'points' ? h('div.tie-note', null, `by ${t.decidedBy}`) : null,
      );
    return h(
      'div.rounds',
      null,
      ...playoff.rounds.map((round) => h('div.round', null, h('h3', null, round.name), ...round.ties.map(tie))),
      playoff.thirdPlace ? h('div.round', null, h('h3', null, '3rd place'), tie(playoff.thirdPlace)) : null,
    );
  }

  private podium(ranking: string[]): HTMLElement {
    return h(
      'ol.podium',
      null,
      ...ranking.slice(0, 3).map((id, i) => h('li', null, ['🏆', '🥈', '🥉'][i], ' ', this.name(id))),
    );
  }

  private results(status: LiveStatus): HTMLElement {
    const fixtures = new Map(status.plan.fixtures.map((f) => [f.id, f]));
    const running = status.running.map((id) => fixtures.get(id)).filter((f) => f !== undefined);
    return h(
      'ul.results',
      null,
      ...running.map((f) =>
        h(
          'li.running',
          null,
          h('span.label', null, '● ', f.label),
          h('span.who', null, f.seats.map((id) => this.name(id)).join(' vs ')),
        ),
      ),
      ...[...status.results]
        .reverse()
        .slice(0, 40)
        .map((r) => {
          const fixture = fixtures.get(r.fixtureId);
          const seats = fixture?.seats ?? [];
          return h(
            'li',
            { onclick: () => void this.openReplay(r, false), title: 'Watch' },
            h('span.label', null, fixture?.label ?? r.fixtureId),
            h(
              'span.who',
              null,
              ...seats.map((id, seat) =>
                h(
                  'span',
                  { class: r.placements[seat].rank === 1 ? 'won' : '' },
                  `${this.name(id)} #${r.placements[seat].rank}`,
                ),
              ),
            ),
          );
        }),
    );
  }

  /** Shows a match over the tables. Resolves true once it has played to the end (broadcast). */
  private async openReplay(result: FixtureResult, broadcast: boolean): Promise<boolean> {
    this.closeReplay();
    const replay = await loadJson<Replay>(new URL(result.replay, new URL(this.url, location.href)).href);
    const plugin = this.options.viewerFor(replay.game.id);
    if (!plugin) return false;
    return new Promise((resolve) => {
      this.player = new ReplayPlayer(replay, plugin, {
        speed: this.options.speed,
        autoplay: broadcast,
        broadcast,
        onFinished: () => resolve(true),
      });
      this.overlay = h(
        'div.overlay',
        null,
        broadcast
          ? null
          : h(
              'button.close',
              {
                onclick: () => {
                  this.closeReplay();
                  resolve(false);
                },
                title: 'Close (Esc)',
              },
              '✕',
            ),
        this.player.el,
      );
      document.body.append(this.overlay);
      if (!broadcast) resolve(false);
    });
  }

  private closeReplay(): void {
    this.player?.destroy();
    this.overlay?.remove();
    this.player = null;
    this.overlay = null;
  }
}
