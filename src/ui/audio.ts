import { settings } from './settings';

export type Sfx = 'battle' | 'clctblts' | 'dope' | 'flg_cap' | 'megaexpl' | 'megafly' | 'new_rnd' | 'strtgame';
export type Voice =
  | 'aaaaaaah' | 'asta' | 'cattle' | 'crush' | 'crushyou' | 'finished' | 'lovegame' | 'luchy' | 'my_day'
  | 'nanner' | 'no' | 'nothing' | 'prisoner' | 'pwr_crpt' | 'runhide' | 'scum' | 'tomega' | 'yeehaw';
export type Mood = 'menu' | 'game' | 'win' | 'lose';

const TRACKS: Record<Mood, string[]> = {
  menu: ['pensive'],
  game: ['cruising', 'obsessed', 'fly-by', 'dogfight'],
  win: ['victory6'],
  lose: ['loser'],
};

/** Voice lines by occasion. */
export const TAUNTS = {
  win: ['crush', 'crushyou', 'scum', 'cattle', 'prisoner', 'nothing', 'my_day', 'nanner', 'luchy', 'runhide'] as Voice[],
  lose: ['aaaaaaah', 'no'] as Voice[],
  kill: ['finished', 'asta'] as Voice[],
  missile: ['tomega', 'yeehaw'] as Voice[],
};

const MUSIC_GAIN = 0.6;

class AudioManager {
  private music: HTMLAudioElement | null = null;
  private mood: Mood | null = null;
  private track = 0;
  private unlocked = false;
  private lastVoice = 0;
  private playing = new Map<string, HTMLAudioElement>();

  constructor() {
    const unlock = () => {
      this.unlocked = true;
      if (this.mood) this.start(this.mood);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }
  }

  /** Switches the background music; the same mood keeps playing uninterrupted. */
  setMood(mood: Mood | null): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.track = mood ? Math.floor(Math.random() * TRACKS[mood].length) : 0;
    if (this.music) {
      this.music.pause();
      this.music = null;
    }
    if (mood && this.unlocked) this.start(mood);
  }

  private start(mood: Mood): void {
    if (this.music) return;
    const list = TRACKS[mood];
    const audio = new Audio(`audio/music/${list[this.track % list.length]}.mp3`);
    audio.volume = settings.music * MUSIC_GAIN;
    audio.addEventListener('ended', () => {
      if (this.music !== audio) return;
      this.music = null;
      if (mood === 'win' || mood === 'lose') {
        this.mood = null;
        this.setMood('menu');
      } else {
        this.track++;
        this.start(mood);
      }
    });
    this.music = audio;
    audio.play().catch(() => { this.music = null; });
  }

  applyVolume(): void {
    if (this.music) this.music.volume = settings.music * MUSIC_GAIN;
  }

  sfx(name: Sfx, opts: { volume?: number; maxMs?: number } = {}): void {
    if (!this.unlocked || settings.sfx <= 0) return;
    this.stop(name);
    const audio = new Audio(`audio/sfx/${name}.mp3`);
    audio.volume = Math.min(1, settings.sfx * (opts.volume ?? 1));
    this.playing.set(name, audio);
    audio.addEventListener('ended', () => this.playing.delete(name));
    audio.play().catch(() => {});
    if (opts.maxMs) setTimeout(() => this.fade(name, audio), opts.maxMs);
  }

  stop(name: Sfx): void {
    const audio = this.playing.get(name);
    if (audio) {
      audio.pause();
      this.playing.delete(name);
    }
  }

  private fade(name: string, audio: HTMLAudioElement): void {
    const step = () => {
      if (audio.paused) return;
      if (audio.volume <= 0.06) {
        audio.pause();
        if (this.playing.get(name) === audio) this.playing.delete(name);
        return;
      }
      audio.volume = Math.max(0, audio.volume - 0.06);
      setTimeout(step, 30);
    };
    step();
  }

  /** Plays a general's voice line; lines never overlap and are spaced out. */
  voice(name: Voice | Voice[], force = false): void {
    if (!this.unlocked || !settings.voices || settings.sfx <= 0) return;
    const now = Date.now();
    if (!force && now - this.lastVoice < 7000) return;
    this.lastVoice = now;
    const pick = Array.isArray(name) ? name[Math.floor(Math.random() * name.length)] : name;
    const audio = new Audio(`audio/voice/${pick}.mp3`);
    audio.volume = Math.min(1, settings.sfx);
    audio.play().catch(() => {});
  }
}

export const audio = new AudioManager();
