/**
 * Minimal typed Command/Query dispatcher (Issue #105 Phase 1 Spike).
 *
 * Design decision (Issue #105 §六): evaluated external CommandBus libraries
 * (@artworkdev/cqrs, @lgse/cqrs, @nestjs/cqrs, node-cqrs). All either pull
 * decorator/DI requirements, RxJS, or framework coupling that a native
 * node:http + SQLite backend does not need. The Command-oriented boundary is
 * the Use Case itself, not the existence of a framework bus, so we ship a
 * ~60-line typed dispatcher as the baseline instead:
 *
 * - One command name maps to exactly one handler (single authoritative
 *   implementation, Issue #105 invariant 7).
 * - The bus owns NO transaction boundary: handlers call runInTransaction()
 *   themselves, keeping money/inventory mutations atomic (Issue #68).
 * - Handlers receive the authenticated GameContext plus their input, so
 *   authorization happens before dispatch (routes build ctx).
 * - Purely synchronous registry: no decorator metadata, no reflection, easy
 *   to remove if a mature library is adopted later.
 */

export interface GameContextLike {
  companyId: number;
  playerId: number;
  realmId: number;
}

export type CommandHandler<TInput, TOutput> = (
  ctx: GameContextLike,
  input: TInput
) => TOutput | Promise<TOutput>;

export class CommandBus {
  private handlers: Record<string, CommandHandler<any, any>> = Object.create(null);

  register<TInput, TOutput>(name: string, handler: CommandHandler<TInput, TOutput>): void {
    if (Object.prototype.hasOwnProperty.call(this.handlers, name)) {
      throw new Error(`Command handler already registered for '${name}' — a command must have exactly one authoritative handler`);
    }
    this.handlers[name] = handler as CommandHandler<any, any>;
  }

  async dispatch<TOutput = unknown>(name: string, ctx: GameContextLike, input: unknown): Promise<TOutput> {
    const handler = this.handlers[name];
    if (!handler) {
      throw new Error(`No command handler registered for '${name}'`);
    }
    return (await handler(ctx, input)) as TOutput;
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.handlers, name);
  }
}

export const commandBus = new CommandBus();
