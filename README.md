# 🎬 Guess The Movie — Multiplayer Party Game

A Jackbox-style party game where players guess movies, TV shows, and characters from blurred images that slowly reveal on a shared TV screen.

## Quick Start

### 1. Get a TMDB API Key (free)
1. Go to [themoviedb.org](https://www.themoviedb.org/) and create a free account
2. Go to Settings → API → Request an API key
3. Copy your API key (v3 auth)

### 2. Install & Run

```bash
# Clone or download this folder
cd guess-the-movie

# Install dependencies
npm install

# Create your .env file
cp .env.example .env
# Edit .env and paste your TMDB API key

# Start the server
npm start
```

The server will show:
```
🎬 Guess The Movie is running!
   Local:   http://localhost:3000
   Network: http://192.168.x.x:3000
```

### 3. Play!

**On the game master's phone:**
1. Open `http://your-ip:3000` 
2. Tap **"Create Game"**
3. Pick your name, difficulty, and which rounds to include
4. Tap **"Create Room"** → you'll see a room code (e.g. `XKPW`)

**On the TV:**
1. Open `http://your-ip:3000/host.html` in the TV browser
2. Enter the room code → TV becomes the display screen

**On each player's phone:**
1. Open `http://your-ip:3000`
2. Tap **"Join Game"**
3. Enter the room code + their name

**Game master taps "Start Game"** → the game begins!

## Game Structure

| Round | Category | Image Shown | Players Guess |
|-------|----------|-------------|---------------|
| 1 | Movie Posters | Official poster | Movie title |
| 2 | TV Show Posters | Show poster | Show title |
| 3 | Movie Scenes | Backdrop screenshot | Movie title |
| 4 | TV Show Scenes | Backdrop screenshot | Show title |
| 5 | Characters | Person photo | Person name |

- Each round has **10 questions**
- Total: **50 questions per game**
- All multiple choice (4 options)
- Faster answers = more points (up to 1,000 per question)

## Difficulty Levels

| Level | Timer | Starting Blur | Starting Circle |
|-------|-------|---------------|-----------------|
| Easy | 45s | Light | Larger |
| Medium | 50s | Moderate | Medium |
| Hard | 60s | Heavy | Tiny |

## Deployment

The app works on any Node.js hosting platform:

**Railway / Render / Fly.io:**
1. Push the code to GitHub
2. Connect the repo to your platform
3. Set the `TMDB_API_KEY` environment variable
4. Deploy — it will auto-detect the start command

**Your own VPS:**
```bash
npm install
TMDB_API_KEY=your_key PORT=3000 node server.js
```

**Important:** All devices (TV + phones) must be on the same network, OR the server must be deployed publicly.

## Tech Stack

- **Backend:** Node.js + Express + Socket.IO
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Data:** TMDB API (The Movie Database)
- **Real-time:** WebSockets via Socket.IO

## Credits

Powered by Naseem Q. All rights reserved.

Movie data provided by [The Movie Database (TMDB)](https://www.themoviedb.org/).
