export type CommandSource = 'cli' | 'pa' | 'api';

export interface CommandContext {
  executorCompanyId: number | null;
  isOp: boolean;
  source: CommandSource;
  realmId?: number;
}

export interface CommandResult {
  success: boolean;
  message: string;
  assistantReply?: string;
  data?: Record<string, unknown> | unknown[];
}

export interface TargetCompany {
  id: number;
  companyId: number;
  name: string;
  realmId: number;
}

export type CommandHandler = (
  args: string[],
  ctx: CommandContext
) => Promise<CommandResult> | CommandResult;

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  requireOp?: boolean;
  handler: CommandHandler;
  subcommands?: Record<string, CommandDefinition>;
}
