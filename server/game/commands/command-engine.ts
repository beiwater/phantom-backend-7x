import { CommandRegistry } from './command-registry.ts';
import { giveCommand, moneyCommand, simboostCommand } from './handlers/asset-commands.ts';
import { timeCommand, economyCommand, cycleCommand } from './handlers/economy-commands.ts';
import { opCommand, deopCommand, kickCommand, banCommand, sayCommand } from './handlers/admin-commands.ts';
import { certCommand } from './handlers/cert-commands.ts';
import { socialRepository } from '../../repositories/social-repository.ts';
import type { CommandContext, CommandDefinition, CommandResult } from './types.ts';

const registry = new CommandRegistry();

const helpCommand: CommandDefinition = {
  name: 'help',
  aliases: ['?', 'commands'],
  description: '列出所有可用的 Minecraft 风格游戏调控指令',
  usage: '/help [command]',
  requireOp: false,
  handler: (args) => {
    if (args.length > 0) {
      const targetCmd = registry.getCommand(args[0]);
      if (!targetCmd) {
        return {
          success: false,
          message: `Unknown command "${args[0]}".`,
          assistantReply: `老板，未找到指令 "${args[0]}"。输入 /help 查看全部指令。`
        };
      }
      const text = `Command: /${targetCmd.name}\nDescription: ${targetCmd.description}\nUsage: ${targetCmd.usage}${targetCmd.aliases ? `\nAliases: ${targetCmd.aliases.map(a => `/${a}`).join(', ')}` : ''}`;
      return {
        success: true,
        message: text,
        assistantReply: `老板，指令【/${targetCmd.name}】用法说明如下：\n用法: ${targetCmd.usage}\n说明: ${targetCmd.description}`
      };
    }

    const all = registry.getAllCommands();
    const lines = all.map(c => `/${c.name.padEnd(10)} - ${c.description} (用法: ${c.usage})`);
    const systemMsg = `Available Commands (${all.length}):\n${lines.join('\n')}`;
    const assistantMsg = `老板，以下是所有可用指令（共 ${all.length} 个）：\n${all.map(c => `• /${c.name}: ${c.description}`).join('\n')}`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: assistantMsg,
      data: all.map(c => ({ name: c.name, description: c.description, usage: c.usage }))
    };
  }
};

// Register all core commands
registry.register(giveCommand);
registry.register(moneyCommand);
registry.register(simboostCommand);
registry.register(timeCommand);
registry.register(economyCommand);
registry.register(cycleCommand);
registry.register(opCommand);
registry.register(deopCommand);
registry.register(kickCommand);
registry.register(banCommand);
registry.register(sayCommand);
registry.register(certCommand);
registry.register(helpCommand);

export function getCommandRegistry(): CommandRegistry {
  return registry;
}

export async function executeCommand(line: string, ctx: CommandContext): Promise<CommandResult> {
  // Resolve OP permission from DB if companyId is present
  if (ctx.executorCompanyId && !ctx.isOp) {
    const isOpSetting = socialRepository.getCompanySetting(ctx.executorCompanyId, 'is_admin_op');
    if (isOpSetting === '1') {
      ctx.isOp = true;
    }
  }

  // CLI source is considered OP by default for server-side terminal users
  if (ctx.source === 'cli') {
    ctx.isOp = true;
  }

  return registry.execute(line, ctx);
}
