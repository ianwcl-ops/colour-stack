# Colour Stack

A private family colour-sorting game inspired by the Color Stack Challenge board game. Move rings between rods until every rod holds just one colour (any colour can end up on any rod). Only the top ring on a rod can move, and each rod holds a limited number of rings. A finished rod gets a tick.

## Ways to play

- **Race someone (2–4 players):** tap *Race someone*, then *Send invite link* and share it with up to 3 others. The room creator picks a level and taps *Start race* whenever 2 or more players are in. Everyone gets the same puzzle after a 3-second countdown and can watch the others live (mini boards on bigger screens, progress bars on phones). The race keeps going until everyone has finished or given up: 1st, 2nd, 3rd and 4th score 3, 2, 1 and 0 points, and points add up across rounds. Someone who opens the link mid-race joins the next round. A 5th person is told the room is full. After a race, everyone taps **Rematch**; the next round starts when all have tapped, and the room creator can pick the level first.
- **Points:** places score 3, 2, 1 and 0, plus a **par bonus**: +2 for finishing at or under par, +1 for finishing within 2 moves of par.
- **Little man mode:** the room creator can switch it on for any player (in the lobby or between rounds). That player races one level easier (Tricky becomes Easy, Hard becomes Tricky; Warm-up stays Warm-up) and gets a Hint button, bigger rings and a cheer with confetti for every finished rod. They compete for the same placings and points; their par bonus uses their own puzzle's par.
- **Switching apps:** phones pause web pages in the background, so connections drop when you switch to Messages or WhatsApp. The game reconnects by itself when you come back, sends any moves you made, and holds your seat for 3 minutes. Closing the browser and reopening the link restores your board, moves and place. If the room creator's phone reloads, the room comes back and everyone rejoins. Tapping Leave ends things straight away.
- **Daily challenge:** one puzzle a day, the same for everyone. You win by sorting it in par moves or fewer. It gets harder towards the weekend (Monday Easy, Saturday and Sunday Expert).
- **Practice:** any of the 5 levels:

| Level | Colours | Rings each | Spare rods |
| --- | --- | --- | --- |
| 1 Warm-up | 3 | 3 | 1 |
| 2 Easy | 4 | 4 | 2 |
| 3 Tricky | 5 | 5 | 2 |
| 4 Hard | 6 | 6 | 2 |
| 5 Expert | 8 | 7 | 1 |

**Stars:** 3 stars for solving in par moves or fewer (par is the proven minimum on small levels, and the best solution the computer found on big ones), 2 stars for slightly over par, and 1 star for any other solve. The stars next to the move counter show what you're still on track for.

**Controls:** tap a rod to lift its top ring, then tap the rod where it should go. You can also swipe from one rod to another. On a keyboard, number keys 1–7 pick rods and Esc puts a ring back. Every colour also has its own shape (circle, triangle, square, diamond, cross, star, heart or ring), so the game works for colour-blind players.

## Privacy

- **Passcode:** the game opens only with the family passcode. Each device needs it once.
- **Room links:** each race has its own random, one-off link, so nobody can join a race they weren't invited to.
- **Search engines:** search engines are told not to list the site.
- **No server:** there are no accounts or tracking, and no game server. Races connect the two browsers directly. PeerJS's free service only introduces them.
- **Limits:** the game files are public on GitHub, so the passcode keeps out casual visitors, not a determined expert. Use a passphrase of three or more words.

### Change the passcode

```sh
npm run passcode -- "your new three word phrase"
git commit -am "Change family passcode" && git push
```

Everyone then needs the new passcode.

## Development

```sh
npm install
npm run dev        # play locally
npm run check      # type check + unit tests + browser tests
```

Process: TypeScript strict mode, with tests written before code for the game rules, puzzle generator, solver, scoring, daily challenge, match protocol, passcode and room links (`tests/`). Playwright browser tests (`e2e/`) cover the passcode gate, solo play, the daily challenge and a full two-player race between two browser windows. GitHub Actions runs everything on every push, and only deploys to GitHub Pages when all tests pass.

| Area | Where |
| --- | --- |
| Game rules, generator, A* solver for par | `src/engine/` |
| Multiplayer protocol (room creator relays moves and decides placings) | `src/net/match.ts` |
| PeerJS and test transports | `src/net/transport.ts` |
| Screens and interaction | `src/main.ts`, `src/ui/` |
