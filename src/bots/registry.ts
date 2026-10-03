import { Bot, BotDefinition, BotOptions } from '../api';

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** The bots available to a host: the menus, the arena and the server all list and create bots here. */
export class BotRegistry {
  private readonly defs = new Map<string, BotDefinition>();

  constructor(definitions: Iterable<BotDefinition> = []) {
    for (const def of definitions) this.register(def);
  }

  register(def: BotDefinition): this {
    if (!ID.test(def.id)) throw new Error(`Bot id "${def.id}" must use lowercase letters, digits and dashes`);
    if (this.defs.has(def.id)) throw new Error(`Two bots share the id "${def.id}"`);
    if (typeof def.create !== 'function') throw new Error(`Bot "${def.id}" has no create() function`);
    this.defs.set(def.id, def);
    return this;
  }

  has(id: string | undefined): boolean {
    return id !== undefined && this.defs.has(id);
  }

  get(id: string): BotDefinition {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Unknown bot "${id}". Known: ${[...this.defs.keys()].join(', ')}`);
    return def;
  }

  /** All definitions, in menu order. */
  list(): BotDefinition[] {
    return [...this.defs.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
  }

  create(id: string, options: BotOptions): Bot {
    return this.get(id).create(options);
  }
}

/**
 * Bot definitions exported by a module: its default export (one definition or an array of them)
 * plus any named export that looks like a definition.
 */
export function definitionsIn(module: Record<string, unknown>): BotDefinition[] {
  const found: BotDefinition[] = [];
  const consider = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(consider);
    else if (isDefinition(value) && !found.includes(value)) found.push(value);
  };
  consider(module.default);
  for (const [name, value] of Object.entries(module)) if (name !== 'default') consider(value);
  return found;
}

function isDefinition(value: unknown): value is BotDefinition {
  const v = value as BotDefinition | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.create === 'function'
  );
}
