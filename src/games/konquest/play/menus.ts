import { fill, h } from '../../../platform/web/dom';
import { modal } from '../../../platform/web/modal';
import {
  BOT_LEVELS,
  BotDefinition,
  BotLevel,
  DEFAULT_RULES,
  GALAXIES,
  MAX_PLAYERS,
  MAX_SIZE,
  MIN_PLAYERS,
  MIN_SIZE,
  createGame,
  galaxyById,
  localize,
  publicState,
  randomSeed,
} from '../api';
import { DEFAULT_BOT_ID, DEFAULT_BOT_LEVEL, bots } from '../bots';
import { PLAYER_COLORS } from './colors';
import { FULL_VIEW, GalaxyView, SPECTATOR } from './galaxyView';
import { Lang, galaxyName, galaxyText, getLang, setLang, speedName, t } from './i18n';
import { rulesContent } from './rules';
import { SPEEDS, SeatConfig, Setup, Speed, loadGame, loadSetup, saveSettings, saveSetup, settings } from './settings';

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
  return h(
    'div.menu.kq-menu',
    null,
    h(
      'div.menu-box',
      null,
      h('h1.kq-title', null, 'KONQUEST'),
      h('p.tagline', null, t('app.subtitle')),
      h(
        'nav',
        null,
        saved
          ? h(
              'button.btn.primary.big',
              { onclick: () => app.continueGame() },
              t('menu.continue'),
              h('small', null, t('game.turn', saved.state.turn)),
            )
          : null,
        h('button.btn.big', { class: saved ? '' : 'primary', onclick: () => app.showSetup() }, t('menu.new')),
        h('button.btn.big', { onclick: () => app.openRules() }, t('menu.rules')),
        h('button.btn.big', { onclick: () => app.openOptions(() => app.showMenu()) }, t('menu.options')),
      ),
      h('p.credits', null, t('menu.credits')),
    ),
  );
}

/** The name of a bot level: the bot's own (KDE's "Offensive"...) or the usual ones. */
export function levelName(def: BotDefinition, level: BotLevel): string {
  return def.levelNames ? localize(def.levelNames[level], getLang()) : t(`level.${level}`);
}

/** What a seat is called when its player gave no name. */
export function seatName(seat: SeatConfig, index: number): string {
  if (seat.name.trim()) return seat.name.trim();
  if (seat.kind === 'human') return `${t('setup.human')} ${index + 1}`;
  const def = bots.get(bots.has(seat.bot) ? seat.bot! : DEFAULT_BOT_ID);
  return def.levels === false ? def.name : `${def.name} (${levelName(def, seat.level ?? DEFAULT_BOT_LEVEL)})`;
}

const TURN_LIMITS = [0, 50, 100, 150, 200];

function defaultSetup(): Setup {
  return {
    galaxy: 'standard',
    width: 14,
    height: 14,
    neutrals: 12,
    fair: true,
    seed: randomSeed(),
    players: [
      { name: '', kind: 'human' },
      { name: '', kind: 'ai', bot: 'kde', level: 2 },
      { name: '', kind: 'ai', bot: 'becai', level: 2 },
    ],
    rules: { ...DEFAULT_RULES },
    display: { blindMap: false, neutralShips: true, neutralStats: true },
    turnLimit: 0,
  };
}

export function setupScreen(app: MenuApi): HTMLElement {
  const setup: Setup = { ...defaultSetup(), ...loadSetup(), seed: randomSeed() };
  setup.players = setup.players.filter((s) => s.kind === 'human' || bots.has(s.bot));
  while (setup.players.length < MIN_PLAYERS) setup.players.push({ name: '', kind: 'ai', bot: DEFAULT_BOT_ID });
  const preview = new GalaxyView();
  const root = h('div.menu.kq-setup');

  const toggle = (label: string, text: string | null, get: () => boolean, set: (v: boolean) => void) =>
    h(
      'label.kq-check.opt',
      { title: text ?? '' },
      h('span', null, label, text ? h('small.muted', null, text) : null),
      h('input', {
        type: 'checkbox',
        checked: get(),
        onchange: (e: Event) => set((e.target as HTMLInputElement).checked),
      }),
    );
  const number = (label: string, value: number, min: number, max: number, set: (v: number) => void) =>
    h(
      'label.opt',
      null,
      h('span', null, label),
      h('input.kq-num', {
        type: 'number',
        min: String(min),
        max: String(max),
        value: String(value),
        onchange: (e: Event) => {
          const input = e.target as HTMLInputElement;
          const v = Math.max(min, Math.min(max, Math.floor(Number(input.value) || min)));
          input.value = String(v);
          set(v);
        },
      }),
    );

  const drawPreview = () => {
    const def = galaxyById(setup.galaxy);
    if (def) {
      setup.width = def.width;
      setup.height = def.height;
      setup.neutrals = def.neutrals(setup.players.length);
    }
    setup.neutrals = Math.min(setup.neutrals, setup.width * setup.height - setup.players.length);
    const game = createGame({
      players: setup.players.length,
      seed: setup.seed,
      width: setup.width,
      height: setup.height,
      neutrals: setup.neutrals,
      random: !setup.fair,
      rules: setup.rules,
    });
    preview.render(publicState(game), { viewer: SPECTATOR, display: FULL_VIEW });
  };

  const build = () => {
    const galaxies = [...GALAXIES.map((g) => g.id), 'custom'];
    const galaxyCards = h(
      'div.kq-galaxies',
      null,
      ...galaxies.map((id) =>
        h(
          'button.kq-card',
          {
            class: id === setup.galaxy ? 'on' : '',
            onclick: () => {
              setup.galaxy = id;
              // KDE's classic galaxy is KDE's random placement.
              setup.fair = id !== 'kde';
              build();
            },
          },
          h('b', null, galaxyName(id)),
          h('small', null, galaxyText(id)),
        ),
      ),
    );
    const custom =
      setup.galaxy === 'custom'
        ? h(
            'div.kq-custom',
            null,
            number(t('setup.width'), setup.width, MIN_SIZE, MAX_SIZE, (v) => ((setup.width = v), drawPreview())),
            number(t('setup.height'), setup.height, MIN_SIZE, MAX_SIZE, (v) => ((setup.height = v), drawPreview())),
            number(
              t('setup.neutrals'),
              setup.neutrals,
              0,
              MAX_SIZE * MAX_SIZE,
              (v) => ((setup.neutrals = v), drawPreview()),
            ),
          )
        : null;

    const available = bots.list();
    const seatRow = (seat: SeatConfig, i: number) => {
      const kind = h(
        'select',
        {
          onchange: (e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            if (value === 'human') Object.assign(seat, { kind: 'human', bot: undefined });
            else Object.assign(seat, { kind: 'ai', bot: value, level: seat.level ?? DEFAULT_BOT_LEVEL });
            build();
          },
        },
        h('option', { value: 'human', selected: seat.kind === 'human' }, t('setup.human')),
        ...available.map((def) =>
          h('option', { value: def.id, selected: seat.kind === 'ai' && seat.bot === def.id }, def.name),
        ),
      );
      const def = seat.kind === 'ai' ? bots.get(seat.bot!) : null;
      const level =
        def && def.levels !== false
          ? h(
              'select',
              { onchange: (e: Event) => (seat.level = Number((e.target as HTMLSelectElement).value) as BotLevel) },
              ...BOT_LEVELS.map((l) =>
                h('option', { value: String(l), selected: (seat.level ?? DEFAULT_BOT_LEVEL) === l }, levelName(def, l)),
              ),
            )
          : null;
      return h(
        'div.kq-seat',
        { title: def ? localize(def.description, getLang()) : '' },
        h('span.swatch', { style: `--fill:${PLAYER_COLORS[i]}` }),
        h('input.kq-name', {
          value: seat.name,
          placeholder: seatName({ ...seat, name: '' }, i),
          maxLength: 24,
          oninput: (e: Event) => (seat.name = (e.target as HTMLInputElement).value),
        }),
        kind,
        level,
        setup.players.length > MIN_PLAYERS
          ? h(
              'button.x',
              {
                title: t('setup.remove'),
                onclick: () => {
                  setup.players.splice(i, 1);
                  build();
                },
              },
              '✕',
            )
          : null,
      );
    };

    const limit = h(
      'select',
      { onchange: (e: Event) => (setup.turnLimit = Number((e.target as HTMLSelectElement).value)) },
      ...TURN_LIMITS.map((n) =>
        h('option', { value: String(n), selected: n === setup.turnLimit }, n ? String(n) : t('common.none')),
      ),
    );

    fill(
      root,
      h(
        'div.kq-setup-box',
        null,
        h('h2', null, t('setup.title')),
        h(
          'div.kq-setup-cols',
          null,
          h(
            'section',
            null,
            h('h3', null, t('setup.galaxy')),
            galaxyCards,
            custom,
            toggle(
              t('setup.fair'),
              t('setup.fair.text'),
              () => setup.fair,
              (v) => ((setup.fair = v), drawPreview()),
            ),
            h(
              'div.kq-preview',
              null,
              preview.root,
              h(
                'button.btn.small',
                { onclick: () => ((setup.seed = randomSeed()), drawPreview()) },
                '⟳ ',
                t('setup.reroll'),
              ),
            ),
          ),
          h(
            'section',
            null,
            h('h3', null, t('setup.players')),
            ...setup.players.map(seatRow),
            setup.players.length < MAX_PLAYERS
              ? h(
                  'button.btn.small',
                  {
                    onclick: () => {
                      setup.players.push({ name: '', kind: 'ai', bot: DEFAULT_BOT_ID, level: DEFAULT_BOT_LEVEL });
                      build();
                    },
                  },
                  '+ ',
                  t('setup.addPlayer'),
                )
              : null,
            h('h3', null, t('setup.rules')),
            toggle(
              t('setup.cumulative'),
              t('setup.cumulative.text'),
              () => setup.rules.cumulativeProduction,
              (v) => (setup.rules.cumulativeProduction = v),
            ),
            toggle(
              t('setup.afterConquest'),
              t('setup.afterConquest.text'),
              () => setup.rules.productionAfterConquest,
              (v) => (setup.rules.productionAfterConquest = v),
            ),
            number(t('setup.neutralProduction'), setup.rules.neutralProduction, 0, 10, (v) => {
              setup.rules.neutralProduction = v;
              drawPreview();
            }),
            h('label.opt', null, h('span', null, t('setup.turnLimit')), limit),
            h('h3', null, t('setup.display')),
            toggle(
              t('setup.blindMap'),
              t('setup.blindMap.text'),
              () => setup.display.blindMap,
              (v) => (setup.display.blindMap = v),
            ),
            toggle(
              t('setup.neutralShips'),
              null,
              () => setup.display.neutralShips,
              (v) => (setup.display.neutralShips = v),
            ),
            toggle(
              t('setup.neutralStats'),
              null,
              () => setup.display.neutralStats,
              (v) => (setup.display.neutralStats = v),
            ),
          ),
        ),
        h(
          'div.modal-buttons',
          null,
          h('button.btn', { onclick: () => app.showMenu() }, t('common.back')),
          h(
            'button.btn.primary',
            {
              onclick: () => {
                const players = setup.players.map((s, i) => ({ ...s, name: seatName(s, i) }));
                saveSetup(setup);
                app.startGame({ ...setup, players });
              },
            },
            t('common.start'),
          ),
        ),
      ),
    );
    drawPreview();
  };
  build();
  return root;
}

export function optionsModal(onClose?: () => void): void {
  const langs: [Lang, string][] = [
    ['es', 'Español'],
    ['en', 'English'],
  ];
  modal(
    t('opt.title'),
    [
      h(
        'label.opt',
        null,
        h('span', null, t('opt.language')),
        h(
          'select',
          {
            onchange: (e: Event) => {
              settings.lang = (e.target as HTMLSelectElement).value as Lang;
              setLang(settings.lang);
              saveSettings();
            },
          },
          ...langs.map(([code, name]) => h('option', { value: code, selected: settings.lang === code }, name)),
        ),
      ),
      h(
        'label.opt',
        null,
        h('span', null, t('opt.speed')),
        h(
          'select',
          {
            onchange: (e: Event) => {
              settings.speed = Number((e.target as HTMLSelectElement).value) as Speed;
              saveSettings();
            },
          },
          ...SPEEDS.map((s) => h('option', { value: String(s), selected: settings.speed === s }, speedName(s))),
        ),
      ),
    ],
    [{ label: t('common.close'), primary: true }],
    { onClose },
  );
}

export function rulesModal(onClose?: () => void): void {
  modal(t('menu.rules'), rulesContent(), [{ label: t('common.close'), primary: true }], { wide: true, onClose });
}
