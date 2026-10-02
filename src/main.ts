import './style.css';
import { useMap } from './engine/board';
import { audio } from './ui/audio';
import { BoardView } from './ui/boardView';
import { clear, h } from './ui/dom';
import { GameScreen } from './ui/gameScreen';
import { nodeLabel, setLang } from './ui/i18n';
import { installIcons } from './ui/icons';
import { mainMenu, optionsModal, rulesModal, setupScreen } from './ui/menus';
import { closeAllModals } from './ui/modal';
import { Setup, loadGame, settings } from './ui/settings';

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
  // The empty classic board sits behind the menus.
  useMap('classic');
  const board = new BoardView({ click: () => {}, hover: () => {}, label: nodeLabel });
  root.append(h('div.menu-backdrop', null, board.root), el);
}

const app = {
  showMenu(): void {
    audio.setMood('menu');
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

setLang(settings.lang);
installIcons();
app.showMenu();
