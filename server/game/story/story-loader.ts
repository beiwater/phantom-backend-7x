import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoryJson, StoryCharacter } from './types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORIES_DIR = path.resolve(__dirname, '../../data/stories');

class StoryLoader {
  private stories = new Map<string, StoryJson>();
  private characters = new Map<number, StoryCharacter>();
  private loaded = false;

  public loadAllStories(): void {
    this.stories.clear();
    this.characters.clear();

    if (!fs.existsSync(STORIES_DIR)) {
      this.loaded = true;
      return;
    }

    const files = fs.readdirSync(STORIES_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fullPath = path.join(STORIES_DIR, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(content) as StoryJson;
        if (this.validateStory(parsed)) {
          this.stories.set(parsed.id, parsed);
          for (const char of parsed.characters || []) {
            this.characters.set(char.id, char);
          }
        } else {
          console.warn(`[StoryLoader] Skipping invalid story file: ${file}`);
        }
      } catch (err) {
        console.error(`[StoryLoader] Error loading story file ${file}:`, err);
      }
    }

    this.loaded = true;
  }

  private validateStory(story: unknown): story is StoryJson {
    if (!story || typeof story !== 'object') return false;
    const s = story as Partial<StoryJson>;
    if (typeof s.id !== 'string' || !s.id.trim()) return false;
    if (typeof s.title !== 'string' || !s.title.trim()) return false;
    if (!Array.isArray(s.characters) || s.characters.length === 0) return false;
    if (typeof s.initialStage !== 'string' || !s.stages || typeof s.stages !== 'object') return false;
    if (!s.stages[s.initialStage]) return false;
    return true;
  }

  public getStory(id: string): StoryJson | null {
    if (!this.loaded) this.loadAllStories();
    return this.stories.get(id) || null;
  }

  public listStories(): StoryJson[] {
    if (!this.loaded) this.loadAllStories();
    return Array.from(this.stories.values());
  }

  public getStoryCharacter(id: number): StoryCharacter | null {
    if (!this.loaded) this.loadAllStories();
    return this.characters.get(id) || null;
  }

  public reloadStories(): void {
    this.loaded = false;
    this.loadAllStories();
  }
}

export const storyLoader = new StoryLoader();
