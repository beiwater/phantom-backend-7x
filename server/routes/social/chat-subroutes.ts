import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../utils.ts";
import { socialRepository } from "../../repositories/social-repository.ts";
import { companyRepository } from "../../repositories/company-repository.ts";
import { getCompanyById } from "../../game/company.ts";
import { checkRateLimit } from "../../security/rate-limiter.ts";
import { virtualClock } from "../../core/virtual-clock.ts";
import { broadcastAll, broadcastToCompany } from "../../ws/websocket.ts";
import { executeCommand } from "../../game/commands/command-engine.ts";

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

interface SystemAnnouncement {
  text: string;
  expiresAt: number;
}
let activeAnnouncement: SystemAnnouncement | null = null;
let cachedConfiguredRooms: Array<ChatroomSubscriptionEntry> | null = null;

export function getConfiguredChatrooms(): Array<ChatroomSubscriptionEntry> {
  if (cachedConfiguredRooms) {
    return cachedConfiguredRooms;
  }
  try {
    const raw = socialRepository.getCompanySetting(0, "configured_chatrooms");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedConfiguredRooms = parsed;
        return parsed;
      }
    }
  } catch {
    // fallback
  }

  const envCount = parseInt(process.env.CHATROOM_COUNT || "", 10);
  const envPreset = process.env.CHATROOM_PRESET?.toLowerCase();

  if (envPreset && CHATROOM_PRESETS[envPreset]) {
    cachedConfiguredRooms = CHATROOM_PRESETS[envPreset];
    return cachedConfiguredRooms;
  }
  if (Number.isInteger(envCount) && envCount > 0) {
    cachedConfiguredRooms = DEFAULT_CHATROOMS.slice(0, envCount);
    return cachedConfiguredRooms;
  }

  cachedConfiguredRooms = DEFAULT_CHATROOMS;
  return cachedConfiguredRooms;
}

export function setConfiguredChatrooms(options: {
  count?: number;
  preset?: string;
  rooms?: Array<ChatroomSubscriptionEntry>;
  reset?: boolean;
}): { success: boolean; count: number; chatrooms: Array<ChatroomSubscriptionEntry> } {
  if (options.reset) {
    cachedConfiguredRooms = null;
    socialRepository.upsertCompanySetting(0, "configured_chatrooms", "[]");
    const chatrooms = getConfiguredChatrooms();
    return { success: true, count: chatrooms.length, chatrooms };
  }

  let finalRooms: Array<ChatroomSubscriptionEntry> = DEFAULT_CHATROOMS;

  if (Array.isArray(options.rooms) && options.rooms.length > 0) {
    finalRooms = options.rooms;
  } else if (options.preset && CHATROOM_PRESETS[options.preset.toLowerCase()]) {
    finalRooms = CHATROOM_PRESETS[options.preset.toLowerCase()];
  } else if (typeof options.count === "number" && options.count > 0) {
    finalRooms = DEFAULT_CHATROOMS.slice(0, Math.min(options.count, DEFAULT_CHATROOMS.length));
  }

  socialRepository.upsertCompanySetting(0, "configured_chatrooms", JSON.stringify(finalRooms));

  cachedConfiguredRooms = null;
  return { success: true, count: finalRooms.length, chatrooms: finalRooms };
}

export function loadChatroomSubscriptions(companyId: number): Array<ChatroomSubscriptionEntry> {
  const settingValue = socialRepository.getCompanySetting(companyId, "chatroom_subscriptions");
  let unsubscribed: string[] = [];
  if (settingValue) {
    try {
      const parsed: unknown = JSON.parse(settingValue);
      if (Array.isArray(parsed)) unsubscribed = parsed.map(String);
    } catch {
      unsubscribed = [];
    }
  }
  const stamp = virtualClock.nowIso();
  const availableRooms = getConfiguredChatrooms();
  return availableRooms.map(entry => {
    const withStamp: ChatroomSubscriptionEntry = { ...entry, datetime: stamp };
    return unsubscribed.includes(entry.db_letter) ? { ...withStamp, notSubscribed: true } : withStamp;
  });
}

function getChatroomMetadata(roomCode: string): { chatroom_name: string; chatroom_logo: string; realms_shared: boolean } {
  const rooms = getConfiguredChatrooms();
  const found = rooms.find(r => r.db_letter === roomCode);
  if (found) {
    return {
      chatroom_name: found.name,
      chatroom_logo: found.image,
      realms_shared: found.realmsShared
    };
  }
  if (roomCode === "z" || roomCode === "n") {
    return {
      chatroom_name: roomCode === "z" ? "[ZH_] 社交" : "[ZH] 社交",
      chatroom_logo: "/chat-icon/234B8B/social.png",
      realms_shared: true
    };
  }
  if (roomCode === "N") {
    return {
      chatroom_name: "[ZH] 游戏",
      chatroom_logo: "/chat-icon/234B8B/game.png",
      realms_shared: true
    };
  }
  if (roomCode === "k") {
    return {
      chatroom_name: "[ZH] 交易",
      chatroom_logo: "/chat-icon/234B8B/sales.png",
      realms_shared: false
    };
  }
  if (roomCode === "C") {
    return {
      chatroom_name: "Social",
      chatroom_logo: "/chat-icon/005F73/social.png",
      realms_shared: true
    };
  }
  if (roomCode === "G") {
    return {
      chatroom_name: "Game",
      chatroom_logo: "/chat-icon/005F73/game.png",
      realms_shared: true
    };
  }
  if (roomCode === "H") {
    return {
      chatroom_name: "Help",
      chatroom_logo: "/chat-icon/005F73/help.png",
      realms_shared: true
    };
  }
  if (roomCode === "S") {
    return {
      chatroom_name: "Sales",
      chatroom_logo: "/chat-icon/005F73/sales.png",
      realms_shared: false
    };
  }
  if (roomCode === "X") {
    return {
      chatroom_name: "Aerospace sales",
      chatroom_logo: "/chat-icon/005F73/sales-as.png",
      realms_shared: false
    };
  }
  return {
    chatroom_name: "Room " + roomCode,
    chatroom_logo: "/chat-icon/005F73/game.png",
    realms_shared: true
  };
}

function formatChatMessage(
  m: { id: number; room: string; sender_id: number; sender_company: string; text: string; sent_at: string },
  companyMap?: Map<number, { logo?: string; realmId?: number; supporter?: boolean }>,
  chatroomMeta?: { chatroom_name: string; chatroom_logo: string; realms_shared: boolean }
) {
  const meta = chatroomMeta ?? getChatroomMetadata(m.room);
  let comp = companyMap?.get(m.sender_id);
  if (!comp) {
    const fromRepo = companyRepository.findById(m.sender_id);
    if (fromRepo) {
      comp = {
        logo: fromRepo.logo || "",
        realmId: fromRepo.realmId ?? 0
      };
    }
  }

  return {
    id: m.id,
    sender: {
      id: m.sender_id,
      company: m.sender_company,
      realmId: comp?.realmId ?? 0,
      logo: comp?.logo ?? "",
      moderatorSign: false,
      certificates: 0,
      contest_wins: 0,
      supporter: Boolean(comp?.supporter),
      justStarted: false
    },
    chatroom: m.room,
    chatroom_name: meta.chatroom_name,
    realms_shared: meta.realms_shared,
    datetime: m.sent_at,
    body: m.text,
    chatroom_logo: meta.chatroom_logo,
    ban_notification: false,
    pinned: false,
    invisible: false,
    retracted: false,
    deleted: false,
    isHtml: false
  };
}

export async function handleChatSubroutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. Contacts & chatroom sidebar
  if (pathname === "/api/v2/contacts/") {
    sendJson(res, {
      chatrooms: loadChatroomSubscriptions(currentCompanyId ?? -1)
        .filter(room => !room.notSubscribed)
        .map(({ notSubscribed: _notSubscribed, ...room }) => ({
          ...room,
          protectedForCountry: room.protectedForCountry ?? null
        })),
      contacts: [],
      unreadMessagesOtherRealms: [],
      invisible: false,
      ignoringCompanies: [],
      companiesChatBlockingUs: []
    });
    return true;
  }

  // 2. Error Announcements: /api/v2/error-announcement/
  if (pathname === "/api/v2/error-announcement/") {
    if (method === "GET") {
      if (activeAnnouncement && Date.now() > activeAnnouncement.expiresAt) {
        activeAnnouncement = null;
      }
      sendJson(res, { text: activeAnnouncement ? activeAnnouncement.text : null });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody<{ text?: string; minutes?: number }>(req);
      const text = String(body?.text || "").trim();
      const minutes = Math.max(1, Number(body?.minutes || 30));
      if (text) {
        activeAnnouncement = {
          text,
          expiresAt: Date.now() + minutes * 60 * 1000
        };
      } else {
        activeAnnouncement = null;
      }
      sendJson(res, { text: activeAnnouncement ? activeAnnouncement.text : null });
      return true;
    }
    return false;
  }

  // 3. Help Chatroom: /api/v2/help-chatroom/
  if (pathname === "/api/v2/help-chatroom/" || pathname === "/api/v2/help-chatroom") {
    sendJson(res, {
      name: "help",
      image: "/static/images/chatroom/help.png"
    });
    return true;
  }

  // 4. Captcha endpoints: /api/v2/captcha/, /api/v2/registrations/captcha/
  if (pathname.startsWith("/api/") && pathname.includes("/captcha/")) {
    sendJson(res, { success: true, verified: true, token: "simcomp-local-captcha-token" });
    return true;
  }

  // 5. Chatroom show rules
  const chatRulesMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/show-rules\/$/);
  if (chatRulesMatch) {
    sendJson(res, { success: true });
    return true;
  }

  // 6. Chatroom from id: /api/v2/chatroom/:room/from-id/:id/
  const chatFromIdMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/from-id\/(\d+)\/$/);
  if (chatFromIdMatch) {
    const room = decodeURIComponent(chatFromIdMatch[1]);
    const fromId = Number(chatFromIdMatch[2]) || 0;
    const messages = socialRepository.listChatMessagesFromId(room, fromId, 30);
    const senderIds = Array.from(new Set(messages.map(m => m.sender_id)));
    const companyMap = companyRepository.findBatchBasic(senderIds);
    const meta = getChatroomMetadata(room);
    sendJson(res, messages.map(m => formatChatMessage(m, companyMap, meta)));
    return true;
  }

  // 7. Chatroom Messages
  const chatroomMatch = pathname.match(/^\/api\/v2\/chatroom\/([^/]+)\/$/);
  if (chatroomMatch) {
    const room = decodeURIComponent(chatroomMatch[1]);
    const messages = socialRepository.listChatMessages(room, 30);
    const senderIds = Array.from(new Set(messages.map(m => m.sender_id)));
    const companyMap = companyRepository.findBatchBasic(senderIds);
    const meta = getChatroomMetadata(room);
    sendJson(res, messages.map(m => formatChatMessage(m, companyMap, meta)));
    return true;
  }

  // 8. Send Message
  if ((pathname === "/api/v2/message/" || pathname === "/api/v2/messages/") && method === "POST") {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }

    const rateCheck = checkRateLimit("chat:msg:" + currentCompanyId, 40, 60000);
    if (!rateCheck.allowed) {
      sendJson(res, { error: "Message rate limit exceeded. Please wait before posting again.", code: "RATE_LIMITED" }, 429, {
        "Retry-After": String(Math.ceil(rateCheck.resetMs / 1000))
      });
      return true;
    }

    const body = await readJsonBody<{
      chatroom?: string;
      text?: string;
      body?: string;
      recipient?: number;
      companyId?: number | string;
    }>(req);

    const rawText = typeof body.text === "string" ? body.text : typeof body.body === "string" ? body.body : "";
    const text = rawText.trim();
    if (text.length === 0 || text.length > 2000) {
      sendJson(res, { error: "Message text is invalid" }, 400);
      return true;
    }

    const comp = getCompanyById(currentCompanyId);
    if (!comp) {
      sendJson(res, { error: "Company not found" }, 404);
      return true;
    }

    const now = virtualClock.nowIso();
    let recipientId: number | null = null;
    if (body.companyId !== undefined && body.companyId !== null && String(body.companyId).trim() !== "") {
      recipientId = Number(body.companyId);
    } else if (body.recipient !== undefined && body.recipient !== null) {
      recipientId = Number(body.recipient);
    }

    // In-Game Command Interception (Minecraft-style commands via PA dialog / chat)
    if (text.startsWith('/')) {
      const cmdResult = await executeCommand(text, {
        executorCompanyId: comp.company_id,
        isOp: false, // executeCommand will check DB setting 'is_admin_op'
        source: 'pa',
        realmId: comp.realm_id ?? 0
      });

      // Persist command into message history with PA
      socialRepository.insertDirectMessage(comp.company_id, 0, text, now);

      // Persist assistant reply
      const replyText = cmdResult.assistantReply || cmdResult.message;
      const replyMessageId = socialRepository.insertDirectMessage(0, comp.company_id, replyText, now);

      const replyFormatted = {
        id: replyMessageId,
        sender: {
          id: 0,
          company: "个人助理",
          logo: "/static/images/personal-assistant/old.png",
          certificates: 0,
          supporter: true,
          realmId: comp.realm_id ?? 0
        },
        receiver: {
          id: comp.company_id,
          company: comp.name,
          logo: comp.logo || "",
          certificates: 0,
          supporter: false,
          realmId: comp.realm_id ?? 0
        },
        body: replyText,
        text: replyText,
        datetime: now,
        pinned: false,
        commandResult: cmdResult
      };

      broadcastToCompany(comp.company_id, replyFormatted);
      sendJson(res, replyFormatted);
      return true;
    }

    // Private Direct Message Flow
    if (recipientId !== null && !isNaN(recipientId) && recipientId > 0) {
      const recipientComp = companyRepository.findById(recipientId);
      if (!recipientComp) {
        sendJson(res, { error: "Recipient company not found" }, 404);
        return true;
      }
      const messageId = socialRepository.insertDirectMessage(comp.company_id, recipientComp.companyId, text, now);
      const formatted = {
        id: messageId,
        sender: {
          id: comp.company_id,
          company: comp.name,
          logo: comp.logo || "",
          certificates: 0,
          supporter: false,
          realmId: comp.realm_id ?? 0
        },
        receiver: {
          id: recipientComp.companyId,
          company: recipientComp.name,
          logo: recipientComp.logo || "",
          certificates: 0,
          supporter: false,
          realmId: recipientComp.realmId ?? 0
        },
        body: text,
        text,
        datetime: now,
        pinned: false
      };
      broadcastAll("NEW_MESSAGE", formatted);
      sendJson(res, formatted);
      return true;
    }

    // Public Chatroom Message Flow
    const room = typeof body.chatroom === "string" && body.chatroom.trim()
      ? body.chatroom.trim()
      : "N";
    if (room.length > 100) {
      sendJson(res, { error: "Chatroom is invalid" }, 400);
      return true;
    }

    const messageId = socialRepository.insertChatMessage(room, comp.company_id, comp.name, text, now);
    const meta = getChatroomMetadata(room);
    const compMap = new Map([[comp.company_id, { logo: comp.logo || "", realmId: comp.realm_id ?? 0 }]]);
    const formatted = formatChatMessage({
      id: messageId,
      room,
      sender_id: comp.company_id,
      sender_company: comp.name,
      text,
      sent_at: now
    }, compMap, meta);
    broadcastAll("NEW_MESSAGE", formatted);
    sendJson(res, formatted);
    return true;
  }

  // 9. Private Direct Messages by Company: /api/messages_by_company/
  if (pathname === "/api/messages_by_company/" && method === "GET") {
    const parsedUrl = new URL(req.url || "", "http://127.0.0.1");
    const companyName = parsedUrl.searchParams.get("company")?.trim() || "";
    const companyIdStr = parsedUrl.searchParams.get("company_id")?.trim();
    const companyId = companyIdStr && companyIdStr !== "undefined" ? Number(companyIdStr) : null;
    const lastIdStr = parsedUrl.searchParams.get("last_id")?.trim();
    const lastId = lastIdStr && lastIdStr !== "undefined" ? Number(lastIdStr) : undefined;

    let targetComp = companyId ? companyRepository.findById(companyId) : null;
    if (!targetComp && companyName) {
      targetComp = companyRepository.findByName(companyName);
    }
    if (!targetComp && (companyId === 0 || companyName === "个人助理" || companyName.toLowerCase() === "personal assistant" || companyName.toLowerCase() === "pa")) {
      targetComp = {
        id: 0,
        companyId: 0,
        playerId: 0,
        name: "个人助理",
        money: 0,
        simboosts: 0,
        level: 1,
        rating: 0,
        experience: 0,
        extraBuildingSlots: 0,
        realmId: 0,
        logo: "/static/images/personal-assistant/old.png",
        personalAssistant: "old",
        note: "",
        createdAt: ""
      };
    }

    if (!targetComp) {
      sendJson(res, { status: "error", error: "Company not found" }, 404);
      return true;
    }

    const privateNote = currentCompanyId ? (socialRepository.getCompanyNote(currentCompanyId, targetComp.companyId) || "") : "";
    let messagesList: unknown[] = [];
    let lastMessageId: number | null = null;
    if (currentCompanyId) {
      const rows = socialRepository.listDirectMessages(currentCompanyId, targetComp.companyId, lastId, 30);
      const currentComp = getCompanyById(currentCompanyId);
      messagesList = rows.map(r => ({
        id: r.id,
        sender: r.sender_company_id === currentCompanyId ? {
          id: currentComp?.company_id ?? currentCompanyId,
          company: currentComp?.name || "",
          logo: currentComp?.logo || "",
          certificates: 0,
          supporter: false,
          realmId: currentComp?.realm_id ?? 0
        } : {
          id: targetComp!.companyId,
          company: targetComp!.name,
          logo: targetComp!.logo || "",
          certificates: 0,
          supporter: false,
          realmId: targetComp!.realmId ?? 0
        },
        receiver: r.recipient_company_id === targetComp!.companyId ? {
          id: targetComp!.companyId,
          company: targetComp!.name,
          logo: targetComp!.logo || "",
          certificates: 0,
          supporter: false,
          realmId: targetComp!.realmId ?? 0
        } : {
          id: currentComp?.company_id ?? currentCompanyId,
          company: currentComp?.name || "",
          logo: currentComp?.logo || "",
          certificates: 0,
          supporter: false,
          realmId: currentComp?.realm_id ?? 0
        },
        body: r.message,
        text: r.message,
        datetime: r.created_at,
        pinned: false
      }));
      if (rows.length > 0) {
        lastMessageId = rows[rows.length - 1].id;
      }
    }

    sendJson(res, {
      status: "ok",
      messages: messagesList,
      contact: {
        company: targetComp.name,
        logo: targetComp.logo || "",
        certificates: 0,
        companyId: targetComp.companyId,
        lastMessageId,
        chatBlocked: false,
        unread: 0,
        pinned: false,
        realm: targetComp.realmId ?? 0,
        supporter: false,
        privateNote,
        online: "offline"
      }
    });
    return true;
  }

  // 10. Messages general
  if (pathname === "/api/messages/") {
    if (method === "PATCH") {
      sendJson(res, { status: "ok", success: true });
      return true;
    }
    sendJson(res, { messages: [], contacts: [], unreadMessages: 0 });
    return true;
  }

  // 11. Per-company chatroom subscriptions: /api/v2/companies/chatrooms/:companyId/
  const chatroomSubsMatch = pathname.match(/^\/api\/v2\/companies\/chatrooms\/(\d+|me)\/?$/);
  if (chatroomSubsMatch) {
    const targetId = chatroomSubsMatch[1] === "me" ? currentCompanyId : Number(chatroomSubsMatch[1]);
    if (!targetId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody<{ added?: string[]; deleted?: string[] }>(req);
      const added = Array.isArray(body?.added) ? body.added.map(String) : [];
      const deleted = Array.isArray(body?.deleted) ? body.deleted.map(String) : [];
      let subs = loadChatroomSubscriptions(targetId);
      for (const letter of added) {
        subs = subs.map(s => (s.db_letter === letter ? { ...s, notSubscribed: false } : s));
      }
      for (const letter of deleted) {
        subs = subs.map(s => (s.db_letter === letter ? { ...s, notSubscribed: true } : s));
      }
      socialRepository.upsertCompanySetting(targetId, "chatroom_subscriptions", JSON.stringify(subs.filter(s => s.notSubscribed).map(s => s.db_letter)));
      sendJson(res, subs);
      return true;
    }
    sendJson(res, loadChatroomSubscriptions(targetId));
    return true;
  }

  return false;
}
