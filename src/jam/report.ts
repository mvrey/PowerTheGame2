import { Failure, Replay } from '../platform/core/replay';
import { LiveStatus } from '../platform/node/tournament';

// Plain-text reports for the terminal.

export function describeFailures(failures: Partial<Record<Failure, number>>): string {
  const parts = Object.entries(failures).map(([kind, n]) => `${n} ${kind}`);
  return parts.length ? parts.join(', ') : 'no failures';
}

export function describeReplay(replay: Replay): string {
  const lines = [
    `${replay.match.label ?? replay.match.id}: ${replay.game.id} ${replay.match.setup.format} on ${replay.match.setup.variant}, ` +
      `${replay.turns.length} turns, ended by ${replay.result.reason}`,
  ];
  replay.bots.forEach((bot, seat) => {
    const placement = replay.result.placements[seat];
    const diagnostics = replay.diagnostics[seat];
    const times = replay.turns.map((t) => t.ms[seat]).filter((ms): ms is number => ms !== null);
    const slowest = times.length ? `, slowest answer ${Math.max(...times)} ms` : '';
    lines.push(
      `  #${placement.rank} ${bot.name} (seat ${seat}, score ${placement.score}): ${describeFailures(diagnostics.failures)}${slowest}`,
    );
  });
  return lines.join('\n');
}

export function describeStatus(status: LiveStatus): string {
  const name = (id: string | null) =>
    id === null ? '—' : (status.record.entrants.find((e) => e.id === id)?.name ?? id);
  const lines = [
    `${status.record.title} (${status.results.length} matches played, ${status.plan.pending.length} pending)`,
  ];
  for (const group of status.plan.groups) {
    lines.push(
      '',
      `Group ${group.name}${group.complete ? '' : ' (in progress)'}`,
      '   bot                    P   W  D  L  pts  ffa  material',
    );
    group.standings.forEach((row, i) =>
      lines.push(
        `${String(i + 1).padStart(2)} ${name(row.id).padEnd(20).slice(0, 20)} ${String(row.played).padStart(3)} ${String(row.won).padStart(3)}` +
          `${String(row.drawn).padStart(3)}${String(row.lost).padStart(3)} ${String(row.points).padStart(4)} ${String(row.ffaPoints).padStart(4)} ${String(row.material).padStart(9)}`,
      ),
    );
  }
  if (status.plan.playoff) {
    lines.push('');
    for (const round of status.plan.playoff.rounds)
      for (const tie of round.ties)
        lines.push(
          `${tie.id.padEnd(4)} ${name(tie.a)} ${tie.score[0]}–${tie.score[1]} ${name(tie.b)}` +
            (tie.winner ? `  → ${name(tie.winner)} (${tie.decidedBy})` : ''),
        );
    const third = status.plan.playoff.thirdPlace;
    if (third)
      lines.push(
        `3P   ${name(third.a)} ${third.score[0]}–${third.score[1]} ${name(third.b)}${third.winner ? `  → ${name(third.winner)}` : ''}`,
      );
  }
  if (status.plan.ranking)
    lines.push(
      '',
      'Final ranking:',
      ...status.plan.ranking.map((id, i) => `${String(i + 1).padStart(2)}. ${name(id)}`),
    );
  return lines.join('\n');
}
