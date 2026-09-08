import {
  type ChatroomSubscriptionEntry,
  DEFAULT_CHATROOMS,
  CHATROOM_PRESETS
} from '../domain/social/chat-presets.ts';
import { socialRepository } from '../repositories/social-repository.ts';

export {
  type ChatroomSubscriptionEntry,
  DEFAULT_CHATROOMS,
  CHATROOM_PRESETS
};

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

  cachedConfiguredRooms = finalRooms;
  socialRepository.upsertCompanySetting(0, "configured_chatrooms", JSON.stringify(finalRooms));
  return { success: true, count: finalRooms.length, chatrooms: finalRooms };
}
