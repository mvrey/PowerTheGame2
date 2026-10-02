// Map definitions. A map is a grid of cells; each cell names the space it belongs to:
//
//   G4 B0 Y7 R2   sector of the Green / Blue / Yellow / Red territory, with its number
//   HQG HQB ...   headquarters of an army
//   IN IX IA ...  island (the text after "I" is its label)
//   S1 S2 ...     sea lane
//   .             nothing: no piece can ever be there
//
// A name repeated on several cells makes one bigger space (sea lanes usually are).
// Spaces are adjacent when their cells touch, diagonals included, except that two sea
// lanes never connect. Sectors that touch no sea lane are inland: ships cannot enter them.
// Every map needs the four armies, each with an HQ and at least one sector.

export interface MapDef {
  id: string;
  rows: string[];
  /** Optional relative column widths and row heights; by default rows/columns without sectors are narrower. */
  cols?: number[];
  heights?: number[];
}

const CLASSIC_BANDS = [92, 122, 122, 122, 84, 122, 122, 122, 92];

export const MAPS: MapDef[] = [
  {
    // The board of the original game.
    id: 'classic',
    cols: CLASSIC_BANDS,
    heights: CLASSIC_BANDS,
    rows: [
      'HQG S6  S6  S6  IN  S7  S7  S7  HQB',
      'S5  G8  G6  G3  S1  B5  B7  B8  S8',
      'S5  G7  G4  G1  S1  B2  B4  B6  S8',
      'S5  G5  G2  G0  S1  B0  B1  B3  S8',
      'IW  S4  S4  S4  IX  S2  S2  S2  IE',
      'S12 R3  R1  R0  S3  Y0  Y2  Y5  S9',
      'S12 R6  R4  R2  S3  Y1  Y4  Y7  S9',
      'S12 R8  R7  R5  S3  Y3  Y6  Y8  S9',
      'HQR S11 S11 S11 IS  S10 S10 S10 HQY',
    ],
  },
  {
    // No islands and no channels: the four territories share land borders.
    id: 'continent',
    rows: [
      'HQG S1  S1  S1  S2  S2  S2  HQB',
      'S8  G8  G6  G3  B5  B7  B8  S3',
      'S8  G7  G4  G1  B2  B4  B6  S3',
      'S8  G5  G2  G0  B0  B1  B3  S3',
      'S7  R3  R1  R0  Y0  Y2  Y5  S4',
      'S7  R6  R4  R2  Y1  Y4  Y7  S4',
      'S7  R8  R7  R5  Y3  Y6  Y8  S4',
      'HQR S6  S6  S6  S5  S5  S5  HQY',
    ],
  },
  {
    // The classic board without its central island: each army only reaches its two neighbours.
    id: 'ring',
    cols: CLASSIC_BANDS,
    heights: CLASSIC_BANDS,
    rows: [
      'HQG S6  S6  S6  IN  S7  S7  S7  HQB',
      'S5  G8  G6  G3  S1  B5  B7  B8  S8',
      'S5  G7  G4  G1  S1  B2  B4  B6  S8',
      'S5  G5  G2  G0  S1  B0  B1  B3  S8',
      'IW  S4  S4  S4  .   S2  S2  S2  IE',
      'S12 R3  R1  R0  S3  Y0  Y2  Y5  S9',
      'S12 R6  R4  R2  S3  Y1  Y4  Y7  S9',
      'S12 R8  R7  R5  S3  Y3  Y6  Y8  S9',
      'HQR S11 S11 S11 IS  S10 S10 S10 HQY',
    ],
  },
  {
    // One island in the middle is the only way across by land, while four long
    // sea lanes run from HQ to HQ around the rim.
    id: 'crossroads',
    cols: CLASSIC_BANDS,
    heights: CLASSIC_BANDS,
    rows: [
      'HQG S5  S5  S5  S5  S5  S5  S5  HQB',
      'S8  G8  G6  G3  S1  B5  B7  B8  S6',
      'S8  G7  G4  G1  S1  B2  B4  B6  S6',
      'S8  G5  G2  G0  S1  B0  B1  B3  S6',
      'S8  S4  S4  S4  IX  S2  S2  S2  S6',
      'S8  R3  R1  R0  S3  Y0  Y2  Y5  S6',
      'S8  R6  R4  R2  S3  Y1  Y4  Y7  S6',
      'S8  R8  R7  R5  S3  Y3  Y6  Y8  S6',
      'HQR S7  S7  S7  S7  S7  S7  S7  HQY',
    ],
  },
  {
    // Small homelands scattered among seventeen islands: ground forces hop slowly
    // from island to island, so ships and planes decide the war.
    id: 'archipelago',
    cols: [92, 122, 122, 104, 112, 104, 122, 122, 92],
    heights: [92, 122, 122, 104, 112, 104, 122, 122, 92],
    rows: [
      'HQG S13 S13 IF  IN  IL  S18 S18 HQB',
      'S17 G3  G2  S5  S1  S10 B1  B3  S14',
      'S17 G1  G0  S5  S1  S10 B0  B2  S14',
      'IK  S9  S9  IA  S1  IB  S6  S6  IG',
      'IW  S4  S4  S4  IX  S2  S2  S2  IE',
      'IJ  S8  S8  ID  S3  IC  S11 S11 IM',
      'S16 R2  R0  S12 S3  S7  Y0  Y1  S19',
      'S16 R3  R1  S12 S3  S7  Y2  Y3  S19',
      'HQR S20 S20 IP  IS  IH  S15 S15 HQY',
    ],
  },
];

export const DEFAULT_MAP = 'classic';
export const mapById = (id: string | undefined): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];
