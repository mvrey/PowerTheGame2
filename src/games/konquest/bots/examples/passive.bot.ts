// SPDX-FileCopyrightText: 2013 Alexander Schuch (KDE Konquest); port for this project.
// SPDX-License-Identifier: GPL-2.0-or-later

import { defineBot } from '../../api';

// KDE's example AI (konquest/src/players/ai/example): it never sends a fleet. A sitting duck to
// test against, and the smallest possible bot.

export default defineBot({
  id: 'passive',
  name: 'Passive',
  description: { en: 'Example bot from KDE: never sends a fleet', es: 'Bot de ejemplo de KDE: nunca envía flotas' },
  levels: false,
  order: 60,
  create: () => ({ decide: () => [] }),
});
