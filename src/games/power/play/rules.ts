import { h } from './dom';
import { chip } from './icons';
import { getLang } from './i18n';

interface Section {
  title: string;
  items: string[];
}

const ES: Section[] = [
  {
    title: 'Objetivo',
    items: [
      'Captura las banderas de todos tus rivales. Una bandera cae cuando dominas el Cuartel General (CG) enemigo y entre tus piezas hay al menos un Soldado o un Regimiento.',
      'Quien captura una bandera se queda con todas las piezas y el Power del eliminado.',
      'Si se agota el límite de 2 horas, gana quien sume más poder (desempata el número de banderas).',
    ],
  },
  {
    title: 'La ronda',
    items: [
      'Todos escriben sus órdenes a la vez y en secreto: hasta 5 por ejército, con 3 minutos de reloj.',
      'Después se ejecutan las órdenes de cada jugador, empezando por el árbitro (rota cada ronda).',
      'Cuando todos han movido se resuelven los conflictos, se cobra el Power y se capturan las banderas.',
      'Si no ejecutas ninguna orden pagas 1 Power (o se convierte tu pieza más pequeña).',
    ],
  },
  {
    title: 'Órdenes',
    items: [
      'Mover una pieza (cada pieza mueve una vez por ronda). Pulsa la pieza y luego el destino.',
      'Sacar una pieza de tu Reserva a tu CG (pulsa la pieza en tu tarjeta).',
      'Comprar con Power: Soldado 2, Tanque 3, Caza 5, Destructor 10. La pieza aparece en la Reserva.',
      'Canjear 3 piezas iguales del mismo sitio por la grande. En el tablero, la pieza nueva no mueve hasta la ronda siguiente; en la Reserva sí puede salir.',
      'Crear y lanzar un Megamisil (son dos órdenes).',
    ],
  },
  {
    title: 'Movimiento',
    items: [
      'Se mueve en horizontal, vertical y diagonal. Las piezas enemigas no bloquean el paso.',
      'Soldados y tanques: solo tierra. Para cambiar de territorio pasan por una isla, y al entrar en una isla o en un CG terminan su movimiento.',
      'Aviones: no sobrevuelan el mar, pero pueden pasar sobre una isla sin detenerse.',
      'Barcos: vías marítimas, sectores costeros, islas y CG. Nunca el sector central (4). Las vías no se tocan entre sí.',
    ],
  },
  {
    title: 'Conflictos',
    items: [
      'Si al final de la ronda hay piezas de varios bandos en una casilla, cada uno suma su poder: el mayor captura todas las piezas rivales, que pasan a su color y a su Reserva.',
      'Empate: las piezas que acaban de llegar se repliegan a su casilla de origen. Solo se rebota una vez por ronda.',
      'Tres bandos: si empatan los dos más fuertes, ambos se repliegan y el débil se queda; si empatan los dos débiles, el fuerte captura a ambos.',
    ],
  },
  {
    title: 'Power',
    items: [
      'Al final de cada ronda cobras 1 Power por cada territorio enemigo con bandera en el que tengas alguna pieza (máximo 3). Las islas, el mar y los CG no cuentan.',
    ],
  },
  {
    title: 'Megamisil',
    items: [
      'Se crea canjeando piezas del mismo sitio (y Power, si es en la Reserva) por valor de 100 o más; el exceso se pierde.',
      'No se mueve: se lanza a cualquier casilla, CG o Reserva y destruye todo lo que haya, también lo tuyo. La bandera sobrevive.',
      'Los misiles detonan cuando todos han movido. Sin lanzar tiene poder 0 y cualquiera puede capturarlo.',
    ],
  },
  {
    title: 'Variantes',
    items: [
      'Dos jugadores: cada uno dirige dos ejércitos vecinos, con 5 órdenes por ejército y 6 minutos. Sus fuerzas suman en combate pero no se mezclan en los canjes. Hay que capturar las dos banderas.',
      'Tres jugadores: el cuarto ejército es mercenario. Cualquiera puede gastar sus órdenes en moverlo; si dos jugadores mandan la misma pieza a sitios distintos, no se mueve. Sus capturas van a la Reserva mercenaria.',
    ],
  },
  {
    title: 'Consejos',
    items: [
      'Manda cazas a territorios enemigos en la primera ronda para empezar a cobrar Power.',
      'Tres Tanques valen 9; un Tanque pesado vale 30. Canjea siempre que puedas.',
      'Los sectores 4, 6, 7 y 8 están a un paso de infantería del CG: vigila quién entra en los tuyos.',
      'Un Bombardero plantado en un CG enemigo impide que salgan piezas de su Reserva.',
    ],
  },
];

const EN: Section[] = [
  {
    title: 'Goal',
    items: [
      'Capture the flags of all your rivals. A flag falls when you hold the enemy Headquarters (HQ) and at least one Soldier or Regiment is among your pieces there.',
      'Whoever captures a flag keeps every piece and Power unit of the eliminated player.',
      'If the 2-hour limit runs out, the player with the most total power wins (ties go to the most flags).',
    ],
  },
  {
    title: 'The round',
    items: [
      'Everybody writes orders at the same time and in secret: up to 5 per army, on a 3-minute clock.',
      'Orders are then executed player by player, starting with the referee (which rotates every round).',
      'Once everyone has moved, conflicts are resolved, Power is collected and flags are captured.',
      'If you execute no order you pay 1 Power (or your smallest piece is converted).',
    ],
  },
  {
    title: 'Orders',
    items: [
      'Move a piece (each piece moves once per round). Click the piece, then the destination.',
      'Bring a piece from your Reserve to your HQ (click the piece on your card).',
      'Buy with Power: Soldier 2, Tank 3, Fighter 5, Destroyer 10. The piece appears in your Reserve.',
      'Trade 3 identical pieces on the same space for the big one. On the board the new piece cannot move until next round; in the Reserve it can still deploy.',
      'Build and launch a Megamissile (two orders).',
    ],
  },
  {
    title: 'Movement',
    items: [
      'Pieces move horizontally, vertically and diagonally. Enemy pieces do not block the way.',
      'Soldiers and tanks: land only. They cross between territories through an island, and entering an island or an HQ ends their move.',
      'Planes: never over the sea, but they may fly over an island without stopping.',
      'Ships: sea lanes, coastal sectors, islands and HQs. Never the central sector (4). Sea lanes do not touch each other.',
    ],
  },
  {
    title: 'Conflicts',
    items: [
      'If pieces of several sides share a space at the end of the round, each adds up its power: the highest captures every rival piece, which turns to its colour and goes to its Reserve.',
      'Tie: the pieces that just arrived fall back to where they came from. A piece only bounces once per round.',
      'Three sides: if the two strongest tie they both fall back and the weak one stays; if the two weakest tie, the strongest captures both.',
    ],
  },
  {
    title: 'Power',
    items: [
      'At the end of each round you collect 1 Power for every enemy territory that still has its flag and holds one of your pieces (3 at most). Islands, sea and HQs do not count.',
    ],
  },
  {
    title: 'Megamissile',
    items: [
      'Built by trading pieces on the same space (plus Power, in the Reserve) worth 100 or more; any excess is lost.',
      'It never moves: it is launched at any space, HQ or Reserve and destroys everything there, yours included. The flag survives.',
      'Missiles detonate once everyone has moved. Unlaunched it has power 0 and anyone can capture it.',
    ],
  },
  {
    title: 'Variants',
    items: [
      'Two players: each commands two neighbouring armies, with 5 orders per army and 6 minutes. Their forces add up in combat but cannot be mixed in trades. Both flags must be captured.',
      'Three players: the fourth army is mercenary. Anyone may spend orders moving it; if two players send the same piece to different places it stays put. Its captures go to the mercenary Reserve.',
    ],
  },
  {
    title: 'Tips',
    items: [
      'Send fighters into enemy territories on round one to start collecting Power.',
      'Three Tanks are worth 9; a Heavy tank is worth 30. Trade up whenever you can.',
      'Sectors 4, 6, 7 and 8 are one infantry move from the HQ: watch who walks into yours.',
      'A Bomber parked on an enemy HQ stops pieces leaving its Reserve.',
    ],
  },
];

const HEAD = {
  es: ['Pieza', 'Mov.', 'Poder'],
  en: ['Piece', 'Move', 'Power'],
};

/** Body of the "How to play" dialog. `pieces` is the piece table built by the caller. */
export function rulesContent(pieces: HTMLElement): HTMLElement[] {
  const lang = getLang();
  const sections = lang === 'es' ? ES : EN;
  const head = HEAD[lang];
  pieces.prepend(
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { colSpan: 2 }, head[0]),
        h('th', null, head[1]),
        h('th', null, head[2]),
        h('th'),
        h('th', { colSpan: 2 }, head[0]),
        h('th', null, head[1]),
        h('th', null, head[2]),
      ),
    ),
  );
  const out: HTMLElement[] = [];
  sections.forEach((section, i) => {
    out.push(h('h3', null, section.title), h('ul', null, ...section.items.map((item) => h('li', null, item))));
    if (i === 2) {
      out.push(
        pieces,
        h(
          'p.muted',
          null,
          chip('M', 3),
          ' ',
          lang === 'es'
            ? 'Megamisil: no se mueve, poder 0, cuesta 100.'
            : 'Megamissile: does not move, power 0, costs 100.',
        ),
      );
    }
  });
  return out;
}
