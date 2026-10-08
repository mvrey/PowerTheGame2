import { h } from '../../../platform/web/dom';
import { getLang } from './i18n';

// The rules, as the "How to play" dialog shows them. Longer texts than the rest of the screens,
// so they live here by language rather than in the i18n tables.

const RULES = {
  en: [
    [
      'The goal',
      [
        'Conquer every planet of the galaxy. You are out once you hold no planet and have no fleet in flight; the last player left wins.',
      ],
    ],
    [
      'Planets',
      [
        'Each player starts on a home planet that builds 10 ships per turn and destroys enemy ships with a kill percentage of 0.400.',
        'Neutral planets have their own production (5 to 14) and kill percentage (0.300 to 0.900), and add one ship a turn while nobody holds them.',
        'A planet you conquer builds its full production for you every turn.',
      ],
    ],
    [
      'A turn',
      [
        'Everyone gives orders at the same time: send any number of ships from a planet of yours to any other planet.',
        'Click one of your planets, choose how many ships, then click the destination. Enter ends your turn; Backspace removes the last fleet.',
        '"Repeat every turn" makes a standing order: it goes out every turn while the planet has the ships, until you remove it or lose the planet.',
      ],
    ],
    [
      'Fleets',
      [
        'A fleet takes one turn per two sectors of distance, rounded up (hover over a planet to see it). It cannot be called back.',
        'Arriving at a planet of yours, it joins its defence. Arriving anywhere else, it attacks.',
        "Fleets land player by player, in the order of the players, and each player's fleets in the order they were sent.",
      ],
    ],
    [
      'Battles',
      [
        'Attackers and defenders fire in turns until one side has no ships left. Each shot destroys an enemy ship with the kill percentage of the planet that side fights for: the attackers use the kill percentage of the planet they left.',
        'If the attackers win, the planet is theirs with the ships that survived.',
        'After the landings, every planet builds its ships.',
      ],
    ],
    [
      'Options (KDE)',
      [
        'Cumulative production: production grows by one each turn. Production after conquest: a planet builds even in the turn it is taken.',
        'Blind map: you only see your own ships and fleets. Neutrals may also hide their ships and their stats.',
      ],
    ],
  ],
  es: [
    [
      'El objetivo',
      [
        'Conquista todos los planetas de la galaxia. Quedas fuera cuando no tienes ningún planeta ni flotas en vuelo; gana el último jugador que queda.',
      ],
    ],
    [
      'Planetas',
      [
        'Cada jugador empieza en un planeta natal que construye 10 naves por turno y derriba naves enemigas con un porcentaje de derribo de 0,400.',
        'Los planetas neutrales tienen su propia producción (de 5 a 14) y su porcentaje de derribo (de 0,300 a 0,900), y suman una nave por turno mientras nadie los ocupa.',
        'Un planeta conquistado construye para ti toda su producción cada turno.',
      ],
    ],
    [
      'Un turno',
      [
        'Todos dan órdenes a la vez: envía las naves que quieras desde un planeta tuyo a cualquier otro planeta.',
        'Haz clic en uno de tus planetas, elige cuántas naves y haz clic en el destino. Intro termina el turno; Retroceso quita la última flota.',
        '«Repetir cada turno» crea una orden permanente: sale cada turno mientras el planeta tenga las naves, hasta que la quites o pierdas el planeta.',
      ],
    ],
    [
      'Flotas',
      [
        'Una flota tarda un turno por cada dos sectores de distancia, redondeando hacia arriba (pasa el ratón por un planeta para verlo). No se puede hacer volver.',
        'Si llega a un planeta tuyo, se suma a su defensa. Si llega a cualquier otro, ataca.',
        'Las flotas llegan jugador a jugador, en el orden de los jugadores, y las de cada jugador en el orden en que se enviaron.',
      ],
    ],
    [
      'Batallas',
      [
        'Atacantes y defensores disparan por turnos hasta que a un bando no le quedan naves. Cada disparo derriba una nave enemiga con el porcentaje de derribo del planeta por el que lucha ese bando: los atacantes usan el del planeta del que salieron.',
        'Si ganan los atacantes, el planeta es suyo con las naves que sobrevivieron.',
        'Tras las llegadas, cada planeta construye sus naves.',
      ],
    ],
    [
      'Opciones (KDE)',
      [
        'Producción acumulativa: la producción sube una nave cada turno. Producción tras la conquista: un planeta construye incluso en el turno en que cae.',
        'Mapa a ciegas: solo ves tus naves y tus flotas. Los neutrales también pueden ocultar sus naves y sus datos.',
      ],
    ],
  ],
} as const;

export function rulesContent(): HTMLElement[] {
  return RULES[getLang()].flatMap(([title, paragraphs]) => [
    h('h3', null, title),
    h('ul', null, ...paragraphs.map((p) => h('li', null, p))),
  ]);
}
