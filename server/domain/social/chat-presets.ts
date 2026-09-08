export interface ChatroomSubscriptionEntry {
  name: string;
  language: string;
  category: string;
  image: string;
  db_letter: string;
  realmsShared: boolean;
  protectedForCountry: string | null;
  show_rules?: boolean;
  unread?: number;
  datetime?: string;
  notSubscribed?: boolean;
}

export const DEFAULT_CHATROOMS: Array<ChatroomSubscriptionEntry> = [
  { name: "Supporters", language: "en", category: "supporter", image: "/chat-icon/005F73/supporter.png", db_letter: "P", realmsShared: true, protectedForCountry: null, notSubscribed: true },
  { name: "Game", language: "en", category: "game", image: "/chat-icon/005F73/game.png", db_letter: "G", realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: "Help", language: "en", category: "help", image: "/chat-icon/005F73/help.png", db_letter: "H", realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: "Sales", language: "en", category: "sales", image: "/chat-icon/005F73/sales.png", db_letter: "S", realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: "Aerospace sales", language: "en", category: "sales", image: "/chat-icon/005F73/sales-as.png", db_letter: "X", realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: "Social", language: "en", category: "social", image: "/chat-icon/005F73/social.png", db_letter: "C", realmsShared: true, protectedForCountry: null, show_rules: false, unread: 0 },
  { name: "Roleplay", language: "en", category: "roleplay", image: "/chat-icon/005F73/roleplay.png", db_letter: "R", realmsShared: true, protectedForCountry: null, notSubscribed: true },
  { name: "[ZH] 游戏", language: "zh-cn", category: "game", image: "/chat-icon/234B8B/game.png", db_letter: "N", realmsShared: true, protectedForCountry: null, show_rules: false, unread: 0 },
  { name: "[ZH] 交易", language: "zh-cn", category: "sales", image: "/chat-icon/234B8B/sales.png", db_letter: "k", realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 },
  { name: "[ZH] 社交", language: "zh-cn", category: "social", image: "/chat-icon/234B8B/social.png", db_letter: "n", realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 }
];

export const CHATROOM_PRESETS: Record<string, Array<ChatroomSubscriptionEntry>> = {
  default: DEFAULT_CHATROOMS,
  single: DEFAULT_CHATROOMS.filter(room => room.name === "Game"),
  minimal: [
    { name: "Game", language: "en", category: "game", image: "/chat-icon/005F73/game.png", db_letter: "G", realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 },
    { name: "Help", language: "en", category: "help", image: "/chat-icon/005F73/help.png", db_letter: "H", realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 },
    { name: "Sales", language: "en", category: "sales", image: "/chat-icon/005F73/sales.png", db_letter: "S", realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 }
  ],
  zh: [
    { name: "[ZH] 游戏", language: "zh-cn", category: "game", image: "/chat-icon/234B8B/game.png", db_letter: "N", realmsShared: true, protectedForCountry: null, show_rules: false, unread: 0 },
    { name: "[ZH] 交易", language: "zh-cn", category: "sales", image: "/chat-icon/234B8B/sales.png", db_letter: "k", realmsShared: false, protectedForCountry: null, show_rules: true, unread: 0 },
    { name: "[ZH] 社交", language: "zh-cn", category: "social", image: "/chat-icon/234B8B/social.png", db_letter: "n", realmsShared: true, protectedForCountry: null, show_rules: true, unread: 0 }
  ],
  en: DEFAULT_CHATROOMS.filter(r => r.language === "en")
};
