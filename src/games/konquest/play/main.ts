import './style.css';
import { clear, h } from '../../../platform/web/dom';
import { closeAllModals } from '../../../platform/web/modal';
import { createGame, publicState, randomSeed } from '../api';
import { GameScreen } from './game/gameScreen';
import { FULL_VIEW, GalaxyView, SPECTATOR } from './galaxyView';
import { setLang } from './i18n';
import { mainMenu, optionsModal, rulesModal, setupScreen } from './menus';
import { Setup, loadGame, settings } from './settings';

const root = document.getElementById('app')!;
let game: GameScreen | null = null;

function leaveScreen(): void {
  closeAllModals();
  game?.destroy();
  game = null;
  clear(root);
}

function showMenuScreen(el: HTMLElement): void {
  leaveScreen();
  // A galaxy at war sits behind the menus.
  const backdrop = new GalaxyView();
  backdrop.render(publicState(createGame({ players: 6, seed: randomSeed(), galaxy: 'large' })), {
    viewer: SPECTATOR,
    display: FULL_VIEW,
  });
  root.append(h('div.menu-backdrop.kq-backdrop', null, backdrop.root), el);
}

const app = {
  showMenu(): void {
    showMenuScreen(mainMenu(app));
  },
  showSetup(): void {
    showMenuScreen(setupScreen(app));
  },
  startGame(setup: Setup): void {
    leaveScreen();
    game = new GameScreen(app, setup);
    root.append(game.el);
  },
  continueGame(): void {
    const saved = loadGame();
    if (!saved) return app.showMenu();
    leaveScreen();
    game = new GameScreen(app, saved.setup, saved);
    root.append(game.el);
  },
  openOptions: optionsModal,
  openRules: rulesModal,
};

document.body.classList.add('kq-page');
setLang(settings.lang);
app.showMenu();
