import { OrderSheet, defineBot, legalOrders } from '../../api';

// The smallest useful bot, and a template to start from: each round it gives up to five orders
// picked at random among the legal ones. Missile launches are left out, as a random launch
// mostly blows up its own side.

export default defineBot({
  id: 'rookie',
  name: 'Rookie',
  description: { en: 'Example bot: random legal orders', es: 'Bot de ejemplo: órdenes legales al azar' },
  levels: false,
  order: 50,
  create: () => ({
    decide(view, ctx) {
      const sheet = new OrderSheet(view.state, view.me);
      for (let i = 0; i < 5 && !sheet.full; i++) {
        const options = legalOrders(sheet).filter((o) => o.kind !== 'launch');
        if (!options.length) break;
        sheet.add(options[Math.floor(ctx.rng() * options.length)]);
      }
      return [...sheet.orders];
    },
  }),
});
