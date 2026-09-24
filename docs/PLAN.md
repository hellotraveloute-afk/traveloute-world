# Traveloute — Master Plan

> **Enter a different world that is built on the real one.**
> Traveloute turns real places into a living game world. You explore, uncover the map, claim stars at real places, meet other travelers in person, and spend your stars on real rewards from local businesses.

This document is the single source of truth for what Traveloute is, how it should feel, how it is built, and in what order. It covers product, design, world generation, social systems, economy, money, data, architecture, backend work, and the roadmap.

---

## Table of contents

1. [Vision](#1-vision)
2. [Who it is for](#2-who-it-is-for)
3. [Design pillars](#3-design-pillars)
4. [The experience](#4-the-experience)
5. [Screens](#5-screens)
6. [Visual and audio direction](#6-visual-and-audio-direction)
7. [World generation](#7-world-generation)
8. [Gameplay rules](#8-gameplay-rules)
9. [Social systems](#9-social-systems)
10. [Safety, trust and moderation](#10-safety-trust-and-moderation)
11. [Star economy](#11-star-economy)
12. [Anti-cheat](#12-anti-cheat)
13. [Making money](#13-making-money)
14. [Data collection and privacy](#14-data-collection-and-privacy)
15. [Technical architecture](#15-technical-architecture)
16. [The Flutter ↔ world bridge](#16-the-flutter--world-bridge)
17. [Backend: current state and required work](#17-backend-current-state-and-required-work)
18. [Current codebase review](#18-current-codebase-review)
19. [Roadmap](#19-roadmap)
20. [Metrics](#20-metrics)
21. [Risks and open questions](#21-risks-and-open-questions)
22. [Appendix](#22-appendix)

---

## 1. Vision

### The problem

Travel apps are utilities. Google Maps tells you where things are, booking apps sell you rooms, review apps show you stars. None of them make exploring *feel* like anything, and none of them help you meet the people around you.

The MVP of Traveloute already has the right core idea: visit a real place, earn points, spend them on real rewards. But in its current form it looks and behaves like a utility app (it has been compared to Uber), and it has no social layer at all.

### The answer

Combine three things:

| Inspiration | What we take |
|---|---|
| **Pokémon Go** | The real world as a game board, a tilted 3D camera behind your avatar, places as things to collect, and group events that bring strangers together physically |
| **Google Maps** | Real, accurate, worldwide map data, so the game works anywhere without anyone hand-building it |
| **Loyalty programs** | Points with real value, redeemed at real local businesses |

And add what none of them do well: **a social network built around being in the same place.** Crews, gatherings, trails, and notes you can only read when you stand where they were left.

### One-line pitch

*Traveloute is a game world built on the real map. Explore to uncover it, claim stars at real places, meet travelers in person, and trade stars for real rewards.*

### What success looks like

- People open the app when they are **not** travelling, because there is always something small to do nearby.
- Strangers meet at gatherings and later travel together.
- Local businesses can prove that Traveloute brought real people through their door, and they pay for that.

---

## 2. Who it is for

We design for **both locals and tourists equally**, and one of the product's jobs is to let them meet.

### Local Sri Lankans (18–35)

- Explore their own country on weekends and holidays.
- Strong friend-group culture, so crews and group events fit naturally.
- Mostly Android, including many budget phones, and limited mobile data.
- Want: things to do, bragging rights, local rewards (food, transport, experiences).
- Language: Sinhala, Tamil and English (English first for v1; Sinhala and Tamil planned).

### Foreign tourists

- In the country for one to three weeks.
- Want: hidden spots beyond the obvious list, local tips, and people to explore with.
- Mixed iOS and Android, usually good phones, sometimes a local SIM with limited data.
- Language: English first.

### The bridge between them

Locals know the hidden spots and tourists want them. Gatherings hosted by locals, trails made by locals, and traces left by locals are how the two groups meet. Locals who host and guide should be able to earn from it (see [Making money](#13-making-money)).

---

## 3. Design pillars

Every feature should serve at least one pillar. If it serves none, it does not ship.

1. **A world, not a utility.** Opening the app should feel like stepping into a place. No screen should look like a form or a list of search results unless it has to.
2. **Always something nearby.** Wherever you are, there is something small to do within a short walk.
3. **Better together.** The best rewards come from doing things with other people, in person.
4. **Real value, honestly earned.** Stars can only be earned by really being somewhere. Rewards are real and worth it.
5. **Built on the real world, automatically.** The world is generated from real map data by rules. Nothing depends on someone hand-building a town.
6. **Healthy, not exploitative.** Addictive in the way a good hobby is, never in the way a slot machine is.

---

## 4. The experience

### First launch (onboarding)

1. A short, animated intro: the real map "unfolds" into the game world.
2. Choose an avatar (body, colours, hat, backpack). Keep it under 30 seconds.
3. Location permission, explained in one line: "We use your location to build the world around you and to check you're really at a place."
4. The world builds around the player. The fog around them clears in a satisfying burst.
5. A guided first claim at the nearest place, with the full star burst and stamp animation.
6. Invite: "Join a crew" or "Skip for now".

### Core loops

**Moment to moment (seconds)**
Walk → fog clears → a crystal appears → walk to it → claim → stars fly into your counter → stamp slams into your passport.

**Session (minutes)**
Check quests → scan for hidden places → claim a few → read a trace → see a gathering beacon on the horizon → decide to go.

**Daily**
Three daily quests (one walking, one social, one discovery). A streak that can be protected with a streak freeze. A daily "mystery drop" somewhere in your region.

**Weekly**
Crew territory battle for regions. Weekly featured trail. Leaderboards reset.

**Seasonal (every 2–3 months)**
A season with its own theme, collection set, cosmetic rewards and a world-wide rule change (for example, festival lanterns everywhere for Vesak, or monsoon rain effects).

### The "different world" feeling

The world should feel alive even when you stand still:

- Clouds drift, water shimmers, trees sway, trains move along real railways.
- Time of day follows the real clock (dawn, day, golden hour, night), with the sky, light and glow changing.
- Other players appear as avatars nearby (with privacy rules, see [Safety](#10-safety-trust-and-moderation)).
- Gathering beacons are visible from far away as columns of light.

---

## 5. Screens

The app opens straight into the **World**. Everything else slides up over it, so the world is always one swipe away.

### 5.1 World (home)

- Full-screen 3D world, tilted camera behind the avatar.
- **Top left:** portrait with level ring, name and title.
- **Top right:** star counter; buttons for time of day, sound, compass.
- **Left:** collapsible daily quests card.
- **Bottom:** dock with Passport, Crew, Vault and a large central action button.
- **Context card** above the dock when something is nearby: a place to claim, a gathering to join, a trace to read.
- **Central action button** changes with context:
  - **Scan** (default): sonar pulse that tells you which direction hidden places are.
  - **Claim ★N** near an unclaimed place.
  - **Join N/5** near a live gathering.

### 5.2 Passport

- Traveler card: level, XP bar, title, places visited, provinces, travelers met.
- **Stamps** for every claimed place, styled like ink stamps, with the date.
- **Collections**: themed sets (for example "Hill Country Rails 5/8", "Southern Forts 2/6"), each with a reward when complete.
- Shareable passport card for social media.

### 5.3 Gathering

- Live group event at a place, hosted by a player or a partner.
- Shows who is there, the time left, and the multiplier tiers (2× at 3 people, 3× at 5).
- "I'm on my way" button with distance, and a group chat.
- Check-in requires everyone to be physically close to each other.

### 5.4 Crew

- Crew identity (name, emblem, colour).
- **Territory map**: regions coloured by which crew holds them; contested regions highlighted.
- Weekly standings.
- Crew feed: discoveries, traces, trails and gathering invites from crew members.
- Members online now.

### 5.5 Vault (rewards)

- Star balance and lifetime spent.
- Filters: Near you, Experiences, Food, Stays.
- Rewards with rarity (Common, Rare, Epic, Legendary) and stock.
- **Mystery drops**: time-limited rewards at a place for the first N people who arrive.
- Redeem flow shows a code or QR the partner scans.

### 5.6 Other screens (later)

- Profile and settings (privacy controls, language, notifications, data export and deletion).
- Trail builder (pick places in order, write tips, publish).
- Friends list and invitations.
- Partner (business) dashboard, web-based.

---

## 6. Visual and audio direction

### Style

- **Stylised low-poly 3D.** Flat-shaded terrain and trees, simple buildings with coloured roofs, glowing crystals. It must read clearly on a small screen and run on budget phones.
- **Warm, colourful and inviting**, not dark and grim. The night mode can be moody, but the default should feel sunny and adventurous.
- Game-style UI: chunky display type, glass panels, glowing primary buttons, bouncy motion.

### Palette (starting point)

| Role | Colour | Use |
|---|---|---|
| Gold | `#FFC857` | Stars, primary actions, Epic rarity |
| Coral | `#FF7A59` | Live gatherings, Legendary rarity, the player |
| Mint | `#5CE1C6` | Social, crews, progress, Rare rarity |
| Sky | `#6EC8FF` | Common rarity, water accents |
| Lavender | `#B69CFF` | Traces, mystery, hidden things |
| Ink | `#FFF8EC` | Text on dark UI |
| Deep navy | `#0A1220` | UI background |

### Type

- **Display:** Lilita One (chunky, game-like) for numbers, titles and buttons.
- **Body:** Nunito (rounded, friendly, very readable).

### Motion

- Every reward has a physical moment: burst → fly → land → counter pops.
- Buttons squash when pressed; primary actions gently bounce when available.
- Respect the system "reduce motion" setting.

### Sound

- Short synthesised chimes: tap, discover, claim, level up, scan sweep.
- Ambient sound per area later (birds in forests, waves on beaches, city hum).
- Always mutable, and silent until the first user interaction.

---

## 7. World generation

**The world is not hand-built.** It is generated automatically, anywhere on Earth, from real map data, using a set of style rules. We design the rules once, and the whole planet gets the Traveloute look.

### 7.1 Data sources

| Data | Source | Notes |
|---|---|---|
| Roads, water, land use, buildings, railways, places | **OpenStreetMap** via vector tiles (OpenMapTiles schema). Prototype uses **OpenFreeMap** (free, no API key). | Must show "© OpenStreetMap contributors". For production, consider self-hosting tiles (Protomaps / PMTiles) or a paid provider for reliability. |
| Elevation (hills and valleys) | **Terrain Tiles on AWS Open Data** (Terrarium format PNGs) | Free. Height = (R × 256 + G + B / 256) − 32768 metres. |
| Descriptions and photos of places | Wikipedia / Wikidata (later) | Check each image's licence. |
| Extra and hidden places | Player submissions, reviewed by the community | The Ingress / Pokémon Go approach. |
| Partner locations | Businesses that sign up as sponsors | Also the main revenue source. |
| Live info (opening hours, ratings) | Google Places, only for live display | Google's terms mostly forbid storing their data. Never build the world on it. |

### 7.2 How a tile becomes a world

The map is split into square **tiles**. At zoom 14 a tile is roughly 2.4 km across near the equator. For each tile around the player:

1. **Download** the vector tile (map features) and the elevation tile (heights).
2. **Build terrain:** a grid mesh with heights from the elevation tile, flat-shaded for the low-poly look.
3. **Paint the ground:** draw land use, water, roads and railways onto a texture using the style rules.
4. **Scatter trees** where the rules say (dense in forests, sparse in parks, a few everywhere unmapped so nothing looks empty).
5. **Extrude buildings** from their footprints, with height from the map data or a default.
6. **Place crystals** on real places (viewpoints, waterfalls, temples, peaks, museums, attractions), with rarity from the rules.
7. **Apply fog of war** from the player's saved exploration.

As the player moves, new tiles load ahead and far ones unload. There is no edge to the world.

### 7.3 Style rules (ground and objects)

| Map data | Game look |
|---|---|
| Forest / wood | Dense low-poly trees in mixed greens, dark green ground |
| Grass / meadow | Bright green ground, a few trees |
| Park | Light green ground, scattered trees |
| Farmland / plantation (tea) | Striped terrace pattern, very few trees |
| Wetland | Blue-green ground |
| Sand / beach | Warm sand colour |
| Bare rock | Grey stone |
| Residential area | Warm pale ground, some trees |
| Commercial / industrial | Paved beige ground |
| Water body / river | Animated blue water with sparkle |
| Stream / canal | Blue line with width by type |
| Building | Extruded block, cream walls, terracotta roof; height from data |
| Motorway / trunk | Wide golden road |
| Primary / secondary road | Wide pale road |
| Minor / service road | Narrow pale road |
| Track | Dashed dirt track |
| Footpath | Thin dashed trail |
| Railway | Brown track with sleepers |
| Steep slope | Rock colour (derived from the terrain, not the map) |
| Nothing mapped | Meadow with random trees, so there are no empty holes |

### 7.4 Place (crystal) rules

| Place type | Rarity | Base stars |
|---|---|---|
| Curated hero landmark (for example Sigiriya, Nine Arch Bridge, Temple of the Tooth) | Legendary | 80 |
| Important attraction (high rank in data) | Epic | 45 |
| Viewpoint, waterfall, peak, castle, fort, ruins, monument, archaeological site, museum | Rare | 25 |
| Place of worship, other attraction, zoo, aquarium, theme park | Common | 10 |

- Nearby duplicates (within 40 m) are merged.
- Star values get a small, stable variation per place so not every place is identical.
- Later, star value also uses the backend's existing formula: higher rating and lower popularity give more stars.

### 7.5 Hero landmarks

A few dozen famous places get **custom 3D models** (Nine Arch Bridge with a train crossing, Sigiriya rock, Galle lighthouse). These are the "wow" moments and a strong sponsorship product for tourism boards. Everything else uses generated visuals.

### 7.6 Fog of war

- The world starts covered by a soft fog.
- Walking clears a circle around the player; claimed places keep their surroundings clear.
- Exploration is saved per tile, so your map remembers where you have been.
- "Uncover X% of [area]" is a quest and a stat.

### 7.7 Time of day and seasons

- Time of day follows the real local clock by default, with a manual toggle in settings.
- **Seasonal rule overrides:** because the world is rule-based, one rule change restyles the planet. Examples: lanterns on buildings for Vesak, rain for the monsoon season, special crystals for a season's collection.

---

## 8. Gameplay rules

| Rule | Value (starting point, tune with data) |
|---|---|
| Claim radius | 40 m (GPS mode). The backend currently uses 250 m; tighten it. |
| Claim cooldown per place | 2 days (matches the current backend) |
| Fog clear radius while walking | about 60 m |
| XP per claim | 120 |
| Level curve | Each level needs 1,000 XP more than the last (tune) |
| Gathering multipliers | 2× at 3 travelers, 3× at 5 |
| Gathering check-in | Everyone within 100 m of each other and of the place |
| Scan | Every 2–3 seconds; points toward the nearest hidden place within about 1.5 km |
| Daily quests | 3 per day, reset at local midnight |
| Streak | Daily; one free streak freeze per week |

Titles unlock with levels (for example "Wanderer", "Trailblazer", "Pathfinder", "Legend of Lanka").

---

## 9. Social systems

The current MVP has **no user-to-user features** except a leaderboard. This section is the biggest gap and the heart of the product.

### 9.1 Friends

- Add by username, QR code (scan each other's phones when you meet), or after sharing a gathering.
- See friends' recent discoveries and where they are (only if they choose to share, see privacy).

### 9.2 Crews

- Groups of up to about 50 players with a name, emblem and colour.
- **Territory:** the map is divided into regions (for example Sri Lankan divisional secretariats or a hex grid). Crew members' claims in a region earn points for the crew; the top crew each week "holds" it and its colour shows on the territory map.
- Contested regions (close scores) are highlighted and give bonus points.
- Crew chat and crew-only gatherings.

### 9.3 Gatherings

- A live event at a place for a limited time (for example 30–90 minutes).
- Hosted by a player (from a certain level), a crew, or a partner business.
- Visible from far away as a light beam.
- Multiplier tiers reward bringing more people.
- After the event, participants can add each other as friends in one tap, and "travelers met" goes up.

### 9.4 Trails

- A player-made route: 3–10 places in order, with tips.
- Others follow the trail and claim each stop; completing it gives a bonus.
- The creator earns stars every time someone completes their trail. Popular creators can be featured.

### 9.5 Traces

- A short note or photo left at a place.
- **Only readable when you are physically there.** This keeps local knowledge local and gives people a reason to go.
- Upvotes surface the most useful traces.

### 9.6 Travel buddies

- Opt-in: "I'll be in Ella from the 12th to the 15th."
- Matches people with overlapping dates, places and interests (the backend already tracks interest types).

### 9.7 Feed

- Discoveries, traces, trails and gatherings from friends and crew.
- No infinite global feed; the point is to go outside, not scroll.

---

## 10. Safety, trust and moderation

A location-based social app carries real risk. These are requirements, not extras.

- **Location privacy by default.** Other players never see your exact live location unless you choose to share it with specific friends. On the public map, other players appear with a delay and a fuzzed position, or only inside gatherings.
- **Home protection.** Users can set private zones (home, work) where they never appear and nothing they post shows exact location.
- **Minors.** Decide a minimum age (likely 16 or 18) and enforce it at sign-up. If under-18s are ever allowed, disable location sharing with strangers and adult–minor direct messages.
- **Block and report** on every profile, message, trace and gathering.
- **Moderation** of traces, trail text, usernames and photos: automated filters plus human review of reports.
- **Gatherings at safe, public places only** (the place must be a public point of interest), and in daylight by default.
- **Clear community rules** shown during onboarding.

---

## 11. Star economy

Stars have real value, so the economy must be designed like a small currency.

### Sources (how stars enter)

- Claiming places (biggest source).
- Gathering multipliers.
- Quests and streaks.
- Completing collections and trails.
- Trail creator earnings.
- Approved place submissions.

### Sinks (how stars leave)

- Redeeming partner rewards (main sink).
- Cosmetics (avatar items, passport themes).
- Hosting a gathering (small cost, refunded if enough people join).
- Streak freezes beyond the free one.

### Controls

- Track **stars created vs stars spent** every day. If far more is created than spent, rewards become too easy to get and partners lose money.
- Reward stock is limited per partner per month.
- Partners pay for the rewards they offer (see money section), so redemptions are funded.
- Star values per place can be tuned remotely without an app update.

---

## 12. Anti-cheat

If stars can be faked, the business fails, because partners will not pay for fake visits and the visit data becomes worthless.

**Must-haves before stars have real value:**

1. **Server decides everything.** The server identifies the user from their login token, never from a user ID sent by the app. The server calculates distance, cooldowns and star values.
2. **Mock location detection.** On Android, reject positions flagged as mocked (the `geolocator` package exposes `isMocked`). Detect common spoofing apps.
3. **Device integrity.** Use Google Play Integrity (Android) and App Attest (iOS) to confirm requests come from the real app on a real device.
4. **Movement sanity checks.** Reject impossible speed between claims (for example 40 km in 5 minutes on foot), perfectly straight paths, and identical coordinates across many claims.
5. **Rate limits** per user and per device.
6. **Partner-side confirmation** for high-value rewards (the business scans the code; the server marks it used once).
7. **Review queue** for suspicious accounts, with shadow limits instead of instant bans.

---

## 13. Making money

### For the product

| Stream | How it works | When |
|---|---|---|
| **Pay per verified visit** | Businesses pay when a Traveloute user physically visits and redeems or claims at their location. Strongest pitch: "we bring real people through your door." | v1 with first partners |
| **Sponsored crystals and mystery drops** | A business sponsors a place or a time-limited drop to pull people to them. | v1–v2 |
| **Tourism board campaigns** | Regional campaigns, hero landmark models, themed collections and seasons. | v2 |
| **Reward redemption fee** | Small cut per redemption. | v1 |
| **Season pass (optional)** | Cosmetics, passport themes, exclusive trails. Never pay-to-win: no buying stars for real rewards. | v2 |
| **Booking commissions** | Affiliate links for stays and tours. | v2 |
| **Aggregated insights** | Anonymous, grouped foot-traffic reports for partners and tourism boards. | v2+ (after privacy and legal review) |

### For users

- Rewards from partners (already built in the MVP).
- Trail creators earn stars when others complete their trails.
- Local hosts and guides can earn by hosting gatherings, and later by offering paid tours through the app.

**Keep user earnings as stars redeemed for rewards, not cash**, at least at first. Cash payouts attract fraud and bring legal and tax complications.

---

## 14. Data collection and privacy

### What the MVP already collects

- Account: name, email, password hash or Google sign-in, profile picture, "about me".
- Interest counters per place type (history, nature, culture, religion, city, beach, park, adventure, entertainment, food).
- Visit logs: who claimed where, when, and how much.
- Redemption logs.
- Reviews: rating, text, photos, visit time, wait time, ticket recommendation.
- User-submitted places.
- GPS is only checked at claim time; there is no background tracking.

### What the full product will add

- Exploration (fog-of-war progress per tile).
- Social graph (friends, crews), gathering attendance, trails, traces.
- App usage analytics (screens, funnels, retention) via a tool such as Firebase Analytics or PostHog.

### How insights become money without selling people

- Only **aggregated** numbers are ever shared with businesses ("340 visitors this month, busiest 8–10 AM").
- Minimum group sizes so no individual can be identified.
- Never sell or share individual location histories.

### Rules we follow

- Clear consent during onboarding; analytics opt-out in settings.
- "Export my data" and "Delete my account" in settings.
- Location only when needed (at claim time and while the app is open), unless the user turns on optional features.
- **Sri Lanka:** the Personal Data Protection Act, No. 9 of 2022, is being brought into force in stages.
- **Foreign tourists:** the EU's GDPR can apply to EU residents using the app.
- Get a local lawyer to review the privacy policy and consent flow before launch and before any data product. *(This plan is not legal advice.)*

---

## 15. Technical architecture

### Overview

```
┌────────────────────────────────────────────────────────────┐
│ Flutter app                                                │
│  • All UI: HUD, quests, claim button, passport, crew,      │
│    vault, chat, onboarding, settings                       │
│  • GPS, permissions, login, device integrity checks        │
│  • Talks to the backend                                    │
│                                                            │
│   ┌────────────────────────────────────────────────────┐   │
│   │ WebView (full screen, under the Flutter UI)        │   │
│   │  Three.js world                                    │   │
│   │   • tile loading (vector + elevation)              │   │
│   │   • style rules → terrain, trees, buildings        │   │
│   │   • avatar, crystals, effects, fog, time of day    │   │
│   └────────────────────────────────────────────────────┘   │
│             ▲  messages (JSON)  ▼                          │
└────────────────────────────────────────────────────────────┘
              ▲  HTTPS (REST, JWT)  ▼
┌────────────────────────────────────────────────────────────┐
│ .NET 10 backend (existing, Clean Architecture)             │
│  • Auth, users, places, claims, rewards, reviews           │
│  • NEW: friends, crews, gatherings, trails, traces,        │
│    quests, stamps, collections, anti-cheat, partner portal │
│  • SQL Server                                              │
└────────────────────────────────────────────────────────────┘
              ▲
┌────────────────────────────────────────────────────────────┐
│ Map data: OpenStreetMap vector tiles + AWS terrain tiles   │
│ Images: object storage (Azure Blob / Cloudflare R2)        │
└────────────────────────────────────────────────────────────┘
```

### Why this split

- **Flutter** is excellent for UI and already exists, but is not suited to 3D worlds today (Flutter GPU / `flutter_scene` are still experimental).
- **Three.js in a WebView** reuses the prototype, is quick to iterate, can be updated from the server without an app store release, and keeps the app small.
- **Unity embedded** (`flutter_unity_widget`) is the fallback if WebView performance fails on budget phones, or if we later need AR or heavy game features. The clean bridge (section 16) makes that swap possible without touching the Flutter UI or backend.

### Engine decision rule

Build a Flutter + WebView test with the world and run it on real phones, including at least one budget Android. Target **30+ FPS**. If it fails even with reduced settings (no bloom, no shadows, fewer trees, lower resolution), switch the world to Unity.

### Performance budgets (world)

| Item | Budget (budget phone) | Budget (good phone) |
|---|---|---|
| Frame rate | 30 FPS | 60 FPS |
| Loaded tiles | 3 × 3 | 3 × 3 |
| Trees per tile | ~1,200 | ~3,500 |
| Buildings per tile | ~1,500 | ~4,000 |
| Ground texture per tile | 512 px | 1024 px |
| Post-processing | Off | Bloom on |
| Shadows | Off | On |

### Data and caching

- Cache tiles on the device so revisiting an area costs no data.
- Offer "download area for offline" before a trip.

---

## 16. The Flutter ↔ world bridge

All communication between Flutter and the world uses small JSON messages. **The world never decides game rules**; it only displays and reports.

### Flutter → world

```json
{ "type": "setPlayer", "lat": 6.8667, "lon": 81.0466, "heading": 90 }
{ "type": "setMode", "mode": "gps" }
{ "type": "setPlaces", "places": [ { "id": "abc", "name": "Nine Arch Bridge", "lat": 6.8768, "lon": 81.0608, "rarity": "Legendary", "stars": 80, "status": "open" } ] }
{ "type": "claimResult", "placeId": "abc", "ok": true, "stars": 80 }
{ "type": "setTime", "preset": "night" }
{ "type": "showPlayers", "players": [ { "id": "u1", "name": "Ana", "lat": 6.87, "lon": 81.05 } ] }
{ "type": "setQuality", "level": "low" }
```

### World → Flutter

```json
{ "type": "ready" }
{ "type": "nearPlace", "placeId": "abc", "distanceM": 22 }
{ "type": "leftPlace", "placeId": "abc" }
{ "type": "tappedPlace", "placeId": "abc" }
{ "type": "explored", "tile": "14/12050/7890", "percent": 12.4 }
{ "type": "fps", "value": 41 }
{ "type": "error", "message": "Tile failed to load" }
```

### Rules

- Flutter calls the backend for every claim; the world only plays the effect after `claimResult` says `ok`.
- In production, the list of claimable places comes from the backend (`setPlaces`), not from the raw map data, so the server controls rarity and star values.

---

## 17. Backend: current state and required work

### What exists (good foundation)

- .NET 10, Clean Architecture (Api → Infrastructure → Application → Domain), 42 passing tests.
- Entities: User, UserDetails, Location, LocationImage, Review, ReviewImage, Reward, VisitLog, RedeemLog, GenreSet.
- Star point formula (rating and rarity based), haversine distance, recommendations by interest, leaderboard, redeem codes.
- Roles: Tourist, Admin, Sponsor.

### Must fix before real value flows (priority order)

1. **Authentication on every endpoint.** JWT is configured but no controller uses `[Authorize]`. The user ID must come from the token, never the request body. Today anyone can claim or redeem as any user.
2. **Server-side claim validation** with anti-cheat (section 12).
3. **Remove the Google API key from the Flutter code** (`places_api.dart`). Move the call to the backend or restrict the key in Google Cloud Console. Rotate the exposed key.
4. **Image storage.** Images are stored as base64 text in the database. Move to object storage and store URLs.
5. **REST migration.** Replace the single-route `{"action": ...}` envelope with proper REST routes (the repo already has `docs/PHASE-2-REST.md`).
6. **Tighten the claim radius** from 250 m to about 40 m.

### New entities needed

| Entity | Purpose |
|---|---|
| `Friendship` | Friend requests and accepted friends |
| `Crew`, `CrewMember` | Crews and roles |
| `Region`, `RegionScore` | Territory system |
| `Gathering`, `GatheringAttendee` | Live events and check-ins |
| `Trail`, `TrailStop`, `TrailCompletion` | Player-made routes |
| `Trace`, `TraceVote` | Location-locked notes |
| `Stamp` | Passport entries (could extend VisitLog) |
| `Collection`, `CollectionPlace` | Themed sets |
| `Quest`, `UserQuest` | Daily and weekly quests |
| `Exploration` | Fog-of-war progress per user per tile |
| `Report`, `Block` | Safety |
| `PartnerCampaign` | Sponsored drops and paid visits |
| `DeviceAttestation` | Anti-cheat records |

### Place import job

A backend job imports places from OpenStreetMap for a region (for example all of Sri Lanka), filters them with the place rules (section 7.4), and stores them as `Location` rows with rarity and star value. Rough scale for Sri Lanka: thousands of useful places after filtering (exact counts to be measured on first import).

---

## 18. Current codebase review

### Frontend (Flutter)

- BLoC architecture with pages: auth, home/discover, dashboard/explore (Google Maps), rewards (+ details, logs), leaderboard, location add, location details, review, profile, account, settings.
- Four-tab navigation: Discover, Explore, Rewards, Travelers.
- Theme with light, "ocean" dark and "night" palettes.
- Tests for blocs, models, APIs and validation.
- **Issues:** hard-coded Google API key; UI reads as a utility app; no social features.

### Backend (.NET)

- See section 17. Clean, well documented, tested. Main issues are security (no auth enforcement, client-trusted user IDs and GPS) and the legacy action-envelope API.

### Data

- The seed archive holds 57 users, 12 locations, 19 reviews, 13 rewards. Twelve places is far too few; the place import job fixes this.

---

## 19. Roadmap

Each phase ends with a clear question answered.

### Phase 0 — Design prototype ✅
Playable 3D prototype of the game world (hand-made Ella scene) to settle the look and feel.

### Phase 1 — Real-map world (this repo)
- Three.js world generated from real map data anywhere on Earth.
- Style rules, avatar, GPS and explore modes, crystals on real places, claim, scan, fog of war, time of day.
- **Exit question:** does the automatically built real world look and feel like a game people want to walk around in?

### Phase 2 — Flutter shell and performance test
- Flutter app with the world in a WebView and the message bridge.
- Test on real phones including budget Android.
- **Exit question:** does it run at 30+ FPS on the phones our users have? (If not, evaluate Unity.)

### Phase 3 — Secure backend
- Auth on every endpoint, server-side claims, anti-cheat basics, API key removed, image storage, REST routes.
- Place import job for Sri Lanka.
- **Exit question:** can a determined user fake a claim? (Answer must be "not easily".)

### Phase 4 — Game UI in Flutter
- Rebuild HUD, passport, collections, quests and vault in Flutter on top of the world.
- Accounts and progress saved on the server.
- **Exit question:** do testers come back the next day without being asked?

### Phase 5 — Social layer
- Friends, crews, traces, then gatherings, then trails.
- Safety features (privacy zones, block, report, moderation) ship with the first social feature, not after.
- **Exit question:** do strangers actually meet at gatherings?

### Phase 6 — Partners and money
- Partner portal, sponsored drops, pay-per-visit, redemption verification.
- Pilot with 10–20 businesses in one area (for example Ella or Galle).
- **Exit question:** will a business pay again after the first month?

### Phase 7 — Launch and seasons
- Public launch in Sri Lanka, first season, hero landmarks, Sinhala and Tamil.
- Then expand region by region.

---

## 20. Metrics

| Metric | Why it matters |
|---|---|
| Day 1 / Day 7 / Day 30 retention | Is it habit-forming? |
| Claims per active user per week | Is the core loop working? |
| % of users in a crew | Is the social layer landing? |
| Gatherings held and average attendance | Are people meeting in person? |
| Travelers met per user | The social network's real output |
| Stars created vs spent | Economy health |
| Redemptions per partner per month | Partner value |
| Partner renewal rate | Business viability |
| Suspicious claim rate | Anti-cheat health |
| FPS distribution by device | Technical health |

---

## 21. Risks and open questions

| Risk | Mitigation |
|---|---|
| WebView 3D too slow on budget phones | Early performance test; quality settings; Unity fallback |
| Location spoofing | Section 12, before stars have real value |
| Free tile services rate-limit or go down | Cache tiles; move to self-hosted PMTiles or a paid provider for production |
| Thin map data in rural areas | "Nothing mapped" rules fill gaps; player submissions |
| Safety incidents at gatherings | Public places only, daylight default, block/report, age limits |
| Economy inflation | Daily monitoring, partner-funded rewards, remote tuning |
| Solo developer bandwidth | Strict phase order; prove the riskiest parts first |
| Legal (privacy, promotions, data) | Local legal review before launch |

**Open questions**

- Minimum age: 16 or 18?
- Region system for territory: administrative boundaries or a hex grid?
- Should time of day follow the real clock only, or allow a manual toggle for everyone?
- First partner area: Ella, Galle, or Colombo?
- Brand name and art direction final sign-off.

---

## 22. Appendix

### Glossary

- **Tile:** a square piece of the map at a given zoom level.
- **Vector tile:** map features (roads, water, buildings) as shapes, not pictures.
- **Elevation tile:** an image whose colours encode height.
- **Crystal:** a claimable place in the world.
- **Stamp:** proof in your passport that you claimed a place.
- **Gathering:** a live, time-limited group event at a place.
- **Trace:** a note that can only be read at the place where it was left.
- **Trail:** an ordered route of places made by a player.
- **Fog of war:** the covering over parts of the world you have not explored.

### Attribution required in the app

- Map data © OpenStreetMap contributors.
- Vector tiles: OpenFreeMap (prototype) or the chosen provider.
- Elevation: Terrain Tiles on AWS Open Data (Mapzen), with the data sources they list.

### Related files

- `README.md` — how to run and host the real-map world prototype.
- `js/rules.js` — the style and gameplay rules described in sections 7 and 8, as code.
