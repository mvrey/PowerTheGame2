import './style.css';
import { getBoard } from '../api';
import { audio } from './audio';
import { BoardView } from './boardView';
import { clear, h } from './dom';
import { GameScreen } from './game/gameScreen';
import { nodeLabel, setLang } from './i18n';
import { installIcons } from './icons';
import { mainMenu, optionsModal, rulesModal, setupScreen } from './menus';
import { closeAllModals } from './modal';
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
  // The empty classic board sits behind the menus.
  const board = new BoardView(getBoard('classic'), { click: () => {}, hover: () => {}, label: nodeLabel });
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
