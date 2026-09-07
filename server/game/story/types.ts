export interface StoryCharacter {
  id: number;
  name: string;
  logo: string;
  role?: string;
  realmId?: number;
}

export interface StoryReward {
  money?: number;
  simboosts?: number;
  resources?: Array<{
    resourceId: number;
    amount: number;
    quality?: number;
  }>;
}

export interface StoryGroupMessage {
  characterId: number;
  text: string;
  delayMs?: number;
}

export interface StoryPrivateMessage {
  characterId: number;
  title?: string;
  text: string;
}

export interface StoryChoice {
  text: string;
  nextStage: string;
  reward?: StoryReward;
}

export interface StoryEnding {
  id: string;
  title: string;
  evaluation?: string;
  finalBonus?: StoryReward;
}

export interface StoryStage {
  groupMessages?: StoryGroupMessage[];
  privateMessage?: StoryPrivateMessage;
  choices?: StoryChoice[];
  ending?: StoryEnding;
}

export interface StoryJson {
  id: string;
  title: string;
  description: string;
  characters: StoryCharacter[];
  initialStage: string;
  stages: Record<string, StoryStage>;
}

export interface PlayerStoryStateRow {
  company_id: number;
  story_id: string;
  current_stage: string;
  status: 'active' | 'completed';
  choices_history: string;
  ending_id: string | null;
  updated_at: string;
  created_at: string;
}
