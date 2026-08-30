# Newspaper System

## 1. Newspaper Data Structure

Newspapers are stored in a Redux reducer (`fia` in `chunk_sia.js`):

```js
// State shape:
newspaper: {
    newspapers: {
        0: {},  // realmId -> { issueId -> newspaperData }
        // ...other realms
    },
    fetching: {
        newspapers: {},
        sponsorParams: false
    },
    sponsorParams: null
}
```

Each newspaper issue object:

```json
{
    "id": 123,
    "realmId": 0,
    "issueId": 204,
    "published": "2026-05-28T14:00:00Z",  // or null if not published
    "articles": [
        {
            "id": 456,
            "title": "...",
            "type": "MARKET_VIEW",
            "copy1": "...",
            "copy2": "...",
            "copy3": "...",
            "author": { "company": "SomeCo", "deleted": false, "id": 100 },
            "translatedBy": { "company": "TransCo", "deleted": false, "id": 200 },
            "charts": [...],
            "position": 0,
            "newspaper": { "id": 123, "realmId": 0, "issueId": 204 },
            "reactions": { "THUMBS_UP": 5, "REWARD": 2 },
            "outdated": false,
            "featureHqIdx": null
        }
    ],
    "sponsor0": { "companyName": "SponsorCo", "companyId": 500, "text": "Ad text", "logo": "..." },
    "sponsor1": { ... },
    // ... sponsor0 through sponsor10
    "contests": [...]
}
```

**API Routes:**

| Route | Method | Description |
|-------|--------|-------------|
| `api_v3_newspaper_get_all(lang, realmId)` | GET | List newspapers (paginated with `?below_id=N`) |
| `api_v3_newspaper_get(lang, realmId, issueId)` | GET | Get single newspaper with all articles |
| `api_v3_article_get(lang, newspaperId, articleId)` | GET | Get single article |
| `api_v3_article_get_all(lang, newspaperId)` | POST | Create article (`{ type }`) |
| `api_v3_article_get(lang, newspaperId, articleId)` | PATCH | Update article |
| `api_v3_article_get(lang, newspaperId, articleId)` | DELETE | Remove article |
| `api_v2_articles_by_substring(realmId, query)` | GET | Search articles |
| `api_v2_articles_by_author(companyId)` | GET | Articles by author |
| `api_v2_top_articles_by_reaction(lang, realmId, reaction)` | GET | Top articles by reaction |

## 2. Article Creation & Publishing

### Publishing Schedule

Newspapers are published **every Thursday at 16:00 UTC**. The countdown targets the next upcoming Thursday.

```js
// From ZFn.nextThursday() in chunk_vy_2.js
const e = new Date();
e.setUTCHours(16, 0, 0, 0);                   // 16:00 UTC
e.setUTCDate(e.getUTCDate() - e.getUTCDay() + 4);  // Thursday
if (e < new Date) e.setUTCDate(e.getUTCDate() + 7); // next week if past
```

This is a server-side cron job: "newspaper publishing" is a periodic process listed in the game timetable.

### Creating Articles (Editor only)

Only users with `newspaperEditor` flag can add articles. From `eFn.js`:

```js
// addArticle in sFn class
le().post(F().api_v3_article_get_all(Jr(), newspaper.id), {
    type: type  // "1" or "free column article"
}).then(() => {
    fetchNewspaper(realmId, issueId, callback, true);
});
```

Article types sent at creation are:
- `"1"` — standard column article
- `"free column article"` — free column article

### Article Editing (Editor only)

```js
// updateArticle in Q9n class (chunk_X9n.js)
le().patch(F().api_v3_article_get(Jr(), newspaper.id, id), {
    title: editing === rie ? value : title,
    copy1: editing === zc ? value : copy1,
    copy2: editing === Tu ? value : copy2,
    copy3: editing === y1 ? value : copy3,
    charts: ...
})
```

Additional editor actions:
- **Change side**: `PATCH .../article/{id}` with `{ position: "switch" }` — toggles odd/even position
- **Set author**: `PATCH .../article/{id}` with `{ author: companyName }`
- **Set translatedBy**: `PATCH .../article/{id}` with `{ translatedBy: companyName }`
- **Remove article**: `DELETE .../article/{id}`

### Article Layout

Articles are split into two columns based on position:
- **Odd positions** (1,3,5...) → left column
- **Even positions** (0,2,4...) → right column (first even-position article gets prominence)

```js
const h = f.articles?.filter(v => (v.position || 0) % 2 === 1); // left
const g = f.articles?.filter(v => (v.position || 0) % 2 === 0); // right
```

## 3. Sponsorship System

### Ad Positions

11 sponsorship slots (positions 0-10) per unpublished issue, with three pricing tiers:

| Position | Level | Name | Price |
|----------|-------|------|-------|
| 0 | 2 | Golden | `goldenPrice` (simboosts) |
| 1-2 | 1 | Silver | `silverPrice` (simboosts) |
| 3-10 | 0 | Bronze | `bronzePrice` (simboosts) |

Pricing is fetched from:
```
GET /api/v3/newspaper/{newspaperId}/sponsor/
→ { sponsors: { 0: sponsorData, 1: ... }, pricing: { goldenPrice, silverPrice, bronzePrice } }
```

### Ad Data Structure

```json
{
    "companyName": "Company Name",
    "companyId": 12345,
    "text": "Ad text content",
    "logo": "logo_url"
}
```

### Ad Purchase

Implemented in `chunk_vy_2.js` `Hh` component (not fully decompiled in provided chunks, but structure evident):

- Ads are purchased with **SimBoosts** (not cash)
- Ads appear only in **unpublished** (upcoming) issues
- When all 11 slots are filled: "all advertising spots are taken" message shown
- Max ad text length limit exists (`tooManyCharacters` error)
- Text can be changed (`Change the text of your ad`)
- Terms disclaimer: "Sim Companies Times team reserves the right to remove any ad that does not comply with the game terms without a refund."

### Sponsor Params (from server)

```
GET /api/v2/newspaper/sponsor-params/
```

Stored in Redux as `newspaper.sponsorParams`.

## 4. Reaction System

### Reaction Types

| Reaction | Enum Key | Cost | Requirements |
|----------|----------|------|-------------|
| Thumbs Up | `Qw.THUMBS_UP` | Free | None (anyone can toggle) |
| Reward | `Qw.REWARD` | **5 simboosts** | Level ≥ 20, author exists and not deleted, not own article |

### Constants

```js
// From entry.js
hsr = 20   // minimum player level for reward reaction
uje = 5    // simboosts cost for reward reaction
gsr = 15   // number of top articles shown
```

### API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `api_v1_reaction(articleId, reaction)` | PATCH | Add reaction |
| `api_v1_reaction(articleId, reaction)` | DELETE | Remove reaction (toggle off) |
| `api_v1_reaction_list(newspaperId)` | GET | Get player's own reactions for a newspaper |

### Reaction Implementation (from chunk_M9n.js)

**Thumbs Up (M9n component):**
- Toggle on: `PATCH /api/v1/article/{articleId}/reaction/{Qw.THUMBS_UP}`
- Toggle off: `DELETE /api/v1/article/{articleId}/reaction/{Qw.THUMBS_UP}`
- Shows count: `article.reactions[Qw.THUMBS_UP]` with `+1` visual adjustment
- Visual: border color toggles between `te.reaction.active` (AntiFlashWhite) and `te.reaction.inactive` (SonicSilver)

**Reward (U9n component):**
- Costs 5 simboosts, requires level ≥ 20 (`hsr`)
- Only available if `article.author` exists, not deleted, and not the player's own company
- Triggers confirmation dialog (purchase driver: `Wo.NEWSPAPER_REWARD`)
- On confirm: `PATCH /api/v1/article/{articleId}/reaction/{Qw.REWARD}` then dispatches `lo(-5)` (deduct 5 simboosts from UI)
- On toggle off: `DELETE /api/v1/article/{articleId}/reaction/{Qw.REWARD}`

### Own Reactions State

When viewing a newspaper issue, the player's own reactions are fetched:
```
GET /api/v1/newspaper/{newspaperId}/reaction
→ [ { articleId, reaction }, ... ]
```

Used to determine toggle state for each reaction button.

## 5. Article Categories

### Library Categories (from qrn / qP functions)

Articles in the "Unofficial Library" sidebar are organized by category:

| Index | Category | Description |
|-------|----------|-------------|
| 0 | Troubleshooting | FAQ, supported platforms, bug reporting |
| 1 | Beginners | Guide for beginners, interface tips |
| 2 | Features | Future development, suggesting features, changelog |
| 3 | Mechanics | Research guide, construction guide, bonds, robotics, executives, government orders, aerospace, restaurant guide, collectibles, reference prices, supporters guide, economy model, time table, abundance, leveling, buildings, building auctions |
| 4 | Fairplay | Guide for moderators, fairplay agreement, moderators list |
| 5 | Legal | Terms, privacy, cookie policy, generative AI disclosure |
| 6 | Community | Official SubReddit, submission guide, about the project |

### Article Content Types (cn enum)

The `article.type` field determines which chart/table widget renders the article content:

| Type | Description |
|------|-------------|
| `CUSTOM` | Custom content |
| `MARKET_VIEW` | Exchange market view chart |
| `CONTRACTS_VIEW` | Contracts view chart |
| `RESEARCH` | Research investments chart |
| `TAGS` | Buyer/seller tags statistics |
| `MINE_RESOURCE` | Mine resource production chart |
| `FACTORY_RESOURCE` | Factory resource chart |
| `CONTEST` | Contest results |
| `CRUDE_METHANE_ETHANOL` | Crude/Methane/Ethanol chart |
| `FIBER_ROCKET_FUEL` | Fiber/Rocket fuel chart |
| `BONDS_INVESTMENT` | Bond investments |
| `RESTAURANT_HEATMAP` | Restaurant occupancy heatmap |
| `RESTAURANT_DISTRIBUTION` | Restaurant distribution by rating |
| `BONDS_VIEW` | Bond yields table |
| `GIFT_BASKETS` | Gift baskets data |
| `GOVERNMENT_ORDERS_SUMMARY` | Government orders summary |
| `GENERIC_TABLE` | Generic table |
| `LANDSCAPE` | Structures/buildings table |
| `EXECUTIVE` | Executive positions/skills table |
| `WAREHOUSE` | Warehouse data table |
| `VWAP_PERCENTAGE_AEROSPACE` | Aerospace VWAP percentage chart |
| `VWAP_PERCENTAGE_CONSTRUCTION` | Construction VWAP percentage chart |
| `RETAIL` | Retail amount/VWAP chart |

Special article display types (from chunk_X9n.js):
- `ui.LANDSCAPE` — landscape/wide layout
- `ui.BONDS_UPDATE`, `ui.RESEARCH` — special header sections
- `ui.FASHION_RETAIL`, `ui.ELECTRONICS_RETAIL`, `ui.CAR_RETAIL`, `ui.FOOD_RETAIL`, `ui.ENERGY_RETAIL` — retail category variants

## 6. Top Articles Ranking

### Formula

Top articles are ranked by **number of THUMBS_UP reactions**:

```
GET /api/v2/{lang}/{realmId}/articles/top-by-reaction/THUMBS_UP/
→ { topArticles: [...] }
```

### Display

From `HFn` in chunk_vy_2.js:

- Shows top **15** articles (`gsr = 15`)
- Each entry shows: newspaper icon, **thumbs up count** (reactionCount), article title, author company
- Links to the newspaper issue containing the article
- Title: "Top 15 Articles"

### Data per entry

```json
{
    "title": "Article Title",
    "author": { "company": "AuthorCo" },
    "newspaper": { "realmId": 0, "issueId": 204, "id": 123 },
    "reactionCount": 42
}
```

## 7. Newspaper Display

### Issue List (/newspaper/:realmId)

- Paginated infinite scroll (loads 20 at a time, with `?below_id=N`)
- Shows: issue number, article titles (comma-separated), publish date
- Published issues: normal styling
- Unpublished issues: dimmed styling (visible to moderators/editors only)
- Countdown to next Thursday 16:00 UTC
- **Advertise** sidebar (companyId required): shows ad slots for all unpublished issues
- **Top Articles** sidebar: top 15 by thumbs-up
- **Unofficial Library** sidebar: categorized static guide articles

### Issue Page (/newspaper/:realmId/:issueId)

- Two-column layout
- Left column: position-odd articles, sponsor0 (120px, prominent)
- Right column: first even-position article, sponsor1, sponsor2 (60px each)
- Bottom sponsors: sponsor3-10 in a grid (60px each)
- Previous/Next issue navigation
- Copy URL button
- Published date or "NOT published yet"
- Reactions on each article (thumbs up + reward)
- Editor controls visible to `newspaperEditor` users:
  - Add article buttons ("1" and "free column article")
  - Edit title, copy1, copy2, copy3
  - Change side, set author, set translated by, remove
- "different realm" warning when viewing across realms
- "Outdated article" warning banner when applicable
- "Machine translated" indicator with option to show original
