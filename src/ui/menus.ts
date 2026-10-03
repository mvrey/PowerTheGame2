import { BotLevel, GROUP1, MAPS, PIECES, PieceType, getBoard, localize, mapById } from '../api';
import { bots } from '../bots';
import { audio } from './audio';
import { BoardView } from './boardView';
import { clear, h } from './dom';
import { ARMY_COLORS, chip } from './icons';
import { Key, Lang, armyName, getLang, nodeLabel, pieceName, setLang, t } from './i18n';
import { modal } from './modal';
import { rulesContent } from './rules';
import { SeatConfig, Setup, loadGame, loadSetup, saveSettings, saveSetup, settings } from './settings';

export interface MenuApi {
  showMenu(): void;
  showSetup(): void;
  startGame(setup: Setup): void;
  continueGame(): void;
  openOptions(onClose?: () => void): void;
  openRules(onClose?: () => void): void;
}

export function mainMenu(app: MenuApi): HTMLElement {
  const saved = loadGame();
  return h('div.menu', null,
    h('div.menu-box', null,
      h('h1.logo', null, 'POWER'),
      h('p.tagline', null, t('app.subtitle')),
      h('nav', null,
        saved ? h('button.btn.primary.big', { onclick: () => app.continueGame() },
          t('menu.continue'), h('small', null, t('game.round', saved.state.round))) : null,
        h('button.btn.big', { class: saved ? '' : 'primary', onclick: () => app.showSetup() }, t('menu.new')),
        h('button.btn.big', { onclick: () => app.openRules() }, t('menu.rules')),
        h('button.btn.big', { onclick: () => app.openOptions(() => app.showMenu()) }, t('menu.options')),
      ),
      h('p.credits', null, t('menu.credits')),
    ),
  );
}

interface Rival { bot: string; level: BotLevel }

export function setupScreen(app: MenuApi): HTMLElement {
  const last = loadSetup();
  let map = mapById(last?.map).id;
  let mode: 2 | 3 | 4 = last?.mode ?? 4;
  // One small board per map, drawn once.
  const previews = new Map(MAPS.map((m) =>
    [m.id, new BoardView(getBoard(m.id), { click: () => {}, hover: () => {}, label: nodeLabel }).root] as const));
  let color = last?.players.find((p) => p.kind === 'human')?.armies[0] ?? 3;
  const previous = last?.players.filter((p) => p.kind === 'ai') ?? [];
  const available = bots.list();
  const rivals: Rival[] = [0, 1, 2].map((i) => ({
    bot: bots.has(previous[i]?.bot) ? previous[i].bot! : available[i].id,
    level: previous[i]?.level ?? 2,
  }));
  // Keep the three slots on different bots.
  rivals.forEach((r, i) => {
    if (rivals.findIndex((x) => x.bot === r.bot) !== i)
      r.bot = available.find((d) => !rivals.some((x) => x.bot === d.id))!.id;
  });
  let orderTimer = last?.orderTimer ?? true;
  let gameLimit = last?.gameLimit ?? true;

  const root = h('div.menu');
  const build = (): Setup => {
    const next = (n: number) => (color + n) % 4;
    const players: SeatConfig[] = [{ name: '', kind: 'human', armies: mode === 2 ? [color, next(1)] : [color] }];
    const seats = mode === 2 ? [[next(2), next(3)]] : mode === 3 ? [[next(1)], [next(2)]] : [[next(1)], [next(2)], [next(3)]];
    seats.forEach((armies, i) => {
      const def = bots.get(rivals[i].bot);
      players.push({ name: def.name, kind: 'ai', armies, bot: def.id, level: rivals[i].level });
    });
    return { map, mode, players, orderTimer, gameLimit };
  };
  const armies = (list: number[]) => list.map((a) =>
    h('span.army-tag', { style: `--fill:${ARMY_COLORS[a].fill};--ink:${ARMY_COLORS[a].ink}` }, armyName(a)));

  const render = () => {
    clear(root);
    const setup = build();
    const used = new Set(setup.players.flatMap((p) => p.armies));
    const merc = [0, 1, 2, 3].filter((a) => !used.has(a));
    const rivalRows = setup.players.slice(1).map((p, i) => {
      const def = bots.get(rivals[i].bot);
      const pickBot = h('select', {
        onchange: (e: Event) => {
          const id = (e.target as HTMLSelectElement).value;
          const other = rivals.findIndex((r, j) => j !== i && r.bot === id);
          if (other >= 0) rivals[other].bot = rivals[i].bot;
          rivals[i].bot = id;
          render();
        },
      }, ...available.map((d) => h('option', { value: d.id, selected: d.id === rivals[i].bot }, d.name)));
      const pickLevel = def.levels === false ? null : h('select', {
        onchange: (e: Event) => { rivals[i].level = Number((e.target as HTMLSelectElement).value) as BotLevel; },
      }, ...[1, 2, 3].map((l) => h('option', { value: String(l), selected: l === rivals[i].level }, t(('level.' + l) as Key))));
      return h('div.rival', null,
        h('div.rival-head', null, ...armies(p.armies), pickBot, pickLevel),
        h('div.muted', null, localize(def.description, getLang())));
    });

    root.append(h('div.menu-box.setup', null,
      h('h2', null, t('setup.title')),
      h('h3', null, t('setup.map')),
      h('div.maps', null, ...MAPS.map((m) =>
        h('button.map-card', { class: m.id === map ? 'on' : '', onclick: () => { map = m.id; render(); } },
          previews.get(m.id)!, t(('map.' + m.id) as Key)))),
      h('p.muted.map-text', null, t(('map.' + map + '.text') as Key)),
      h('h3', null, t('setup.players')),
      h('div.seg', null, ...([4, 3, 2] as const).map((m) =>
        h('button.btn', { class: m === mode ? 'on' : '', onclick: () => { mode = m; render(); } }, t(('setup.players.' + m) as Key)))),
      h('h3', null, t('setup.color')),
      h('div.seg', null, ...[0, 1, 2, 3].map((a) =>
        h('button.btn.color', {
          class: a === color ? 'on' : '',
          style: `--fill:${ARMY_COLORS[a].fill};--ink:${ARMY_COLORS[a].ink}`,
          onclick: () => { color = a; render(); },
        }, armyName(a)))),
      mode === 2 ? h('p.muted', null, t('setup.yourArmies', setup.players[0].armies.map(armyName).join(' + '))) : null,
      h('h3', null, t('setup.rivals')),
      ...rivalRows,
      merc.length ? h('p.muted', null, t('setup.merc', merc.map(armyName).join(', '))) : null,
      h('h3', null, t('setup.rulesBox')),
      h('label.check', null,
        h('input', { type: 'checkbox', checked: orderTimer, onchange: (e: Event) => { orderTimer = (e.target as HTMLInputElement).checked; } }),
        t('setup.orderTimer', mode === 2 ? 6 : 3), h('span.tag', null, t('setup.official'))),
      h('label.check', null,
        h('input', { type: 'checkbox', checked: gameLimit, onchange: (e: Event) => { gameLimit = (e.target as HTMLInputElement).checked; } }),
        t('setup.gameLimit'), h('span.tag', null, t('setup.official'))),
      loadGame() ? h('p.warn', null, t('setup.overwrite')) : null,
      h('div.row', null,
        h('button.btn', { onclick: () => app.showMenu() }, t('common.back')),
        h('button.btn.primary', {
          onclick: () => {
            const final = build();
            saveSetup(final);
            app.startGame(final);
          },
        }, t('setup.start'))),
    ));
  };
  render();
  return root;
}

export function optionsModal(onClose?: () => void): void {
  const slider = (key: 'music' | 'sfx', label: string) => h('label.opt', null, h('span', null, label),
    h('input', {
      type: 'range', min: '0', max: '1', step: '0.05', value: String(settings[key]),
      oninput: (e: Event) => {
        settings[key] = Number((e.target as HTMLInputElement).value);
        audio.applyVolume();
        saveSettings();
      },
      onchange: () => { if (key === 'sfx') audio.sfx('new_rnd'); },
    }));
  const toggle = (key: 'voices' | 'hints', label: string) => h('label.check', null,
    h('input', {
      type: 'checkbox', checked: settings[key],
      onchange: (e: Event) => { settings[key] = (e.target as HTMLInputElement).checked; saveSettings(); },
    }), label);
  let handle: { close(): void } | null = null;
  handle = modal(t('opt.title'), [
    h('label.opt', null, h('span', null, t('opt.lang')),
      h('select', {
        onchange: (e: Event) => {
          settings.lang = (e.target as HTMLSelectElement).value as Lang;
          setLang(settings.lang);
          saveSettings();
          // Reopen so the dialog itself is translated.
          const done = onClose;
          onClose = undefined;
          handle?.close();
          optionsModal(done);
        },
      }, h('option', { value: 'es', selected: settings.lang === 'es' }, 'Español'),
      h('option', { value: 'en', selected: settings.lang === 'en' }, 'English'))),
    slider('music', t('opt.music')),
    slider('sfx', t('opt.sfx')),
    toggle('voices', t('opt.voices')),
    h('label.opt', null, h('span', null, t('opt.speed')),
      h('select', {
        onchange: (e: Event) => { settings.speed = Number((e.target as HTMLSelectElement).value) as 1 | 2 | 3; saveSettings(); },
      }, ...[1, 2, 3].map((s) => h('option', { value: String(s), selected: settings.speed === s }, t(('opt.speed.' + s) as Key))))),
    toggle('hints', t('opt.hints')),
  ], [{ label: t('common.close'), primary: true }], { onClose: () => onClose?.() });
}

export function rulesModal(onClose?: () => void): void {
  const range = { inf: 2, tank: 3, air: 5, naval: 1 };
  const table = h('table.pieces', null,
    h('tbody', null, ...GROUP1.map((type) => {
      const up = PIECES[type].up as PieceType;
      const cell = (x: PieceType) => [
        h('td', null, chip(x, 3)), h('td', null, pieceName(x)),
        h('td.num', null, String(range[PIECES[x].cls!])), h('td.num', null, String(PIECES[x].power)),
      ];
      return h('tr', null, ...cell(type), h('td.arrow', null, '3 →'), ...cell(up));
    })));
  modal(t('menu.rules'), rulesContent(table), [{ label: t('common.close'), primary: true }], { wide: true, onClose });
}
