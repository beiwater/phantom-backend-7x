import type { CommandContext, CommandDefinition, CommandResult } from './types.ts';

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();
  private aliases = new Map<string, string>();

  register(def: CommandDefinition): void {
    const key = def.name.toLowerCase().replace(/^\//, '');
    this.commands.set(key, def);
    if (def.aliases) {
      for (const alias of def.aliases) {
        const cleanAlias = alias.toLowerCase().replace(/^\//, '');
        this.aliases.set(cleanAlias, key);
      }
    }
  }

  getCommand(nameOrAlias: string): CommandDefinition | undefined {
    const clean = nameOrAlias.toLowerCase().replace(/^\//, '');
    const canonical = this.aliases.get(clean) || clean;
    return this.commands.get(canonical);
  }

  getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuote) {
        inQuote = false;
        quoteChar = '';
      } else if (/\s/.test(char) && !inQuote) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  async execute(line: string, ctx: CommandContext): Promise<CommandResult> {
    const trimmed = line.trim();
    if (!trimmed) {
      return { success: false, message: 'Empty command.' };
    }

    const tokens = this.tokenize(trimmed);
    if (tokens.length === 0) {
      return { success: false, message: 'Empty command.' };
    }

    const commandName = tokens[0].replace(/^\//, '');
    const args = tokens.slice(1);

    const cmd = this.getCommand(commandName);
    if (!cmd) {
      return {
        success: false,
        message: `Unknown command "/${commandName}". Type /help for available commands.`,
        assistantReply: `老板，抱歉没有找到指令 /${commandName}。输入 /help 可以查看所有可用指令。`
      };
    }

    // Check OP requirement
    if (cmd.requireOp !== false && !ctx.isOp) {
      return {
        success: false,
        message: `Permission denied: Command "/${commandName}" requires OP privileges.`,
        assistantReply: '老板，该指令需要管理员授权。请在对话框输入 `/op <密钥>` 解锁管理员权限！'
      };
    }

    try {
      return await cmd.handler(args, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Command execution error: ${msg}`,
        assistantReply: `老板，执行指令时出错了：${msg}`
      };
    }
  }

  getCompletions(partialLine: string): string[] {
    const trimmed = partialLine.trimStart();
    const tokens = this.tokenize(trimmed);

    // If typing first token (the command)
    if (tokens.length <= 1 && !trimmed.endsWith(' ')) {
      const prefix = (tokens[0] || '').replace(/^\//, '').toLowerCase();
      const suggestions: string[] = [];
      for (const [name] of this.commands) {
        if (name.startsWith(prefix)) {
          suggestions.push(`/${name}`);
        }
      }
      for (const [alias] of this.aliases) {
        if (alias.startsWith(prefix)) {
          suggestions.push(`/${alias}`);
        }
      }
      return Array.from(new Set(suggestions)).sort();
    }

    const cmdName = tokens[0].replace(/^\//, '');
    const cmd = this.getCommand(cmdName);
    if (!cmd) return [];

    // If command has subcommands
    if (cmd.subcommands && tokens.length === 2 && !trimmed.endsWith(' ')) {
      const subPrefix = tokens[1].toLowerCase();
      return Object.keys(cmd.subcommands)
        .filter(sub => sub.startsWith(subPrefix))
        .map(sub => `/${cmdName} ${sub}`);
    }

    return [];
  }
}
