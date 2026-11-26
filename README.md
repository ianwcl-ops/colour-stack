# Colour Stack

A private family game based on the Color Stack Challenge board game. Move rings between rods until your rods match the card. Only the top ring on a rod can move, and each rod holds a limited number of rings.

## Ways to play

- **Race someone:** tap *Race someone*, then *Send invite link*. When the other player opens it, pick a level and tap *Start race*. You both get the same puzzle after a 3-second countdown, and you can watch each other's board live. First to match the card wins. The score carries over between rematches.
- **Daily challenge:** one puzzle a day, the same for everyone. You win by matching the card in par moves or fewer. It gets harder towards the weekend (Monday Easy, Saturday and Sunday Expert).
- **Practice:** any of the 5 levels: Warm-up, Easy, Tricky, Hard and Expert.

**Stars:** 3 stars for solving in par moves or fewer (par is the proven minimum), 2 stars for slightly over par, and 1 star for any other solve. The stars next to the move counter show what you're still on track for.

**Controls:** tap a rod to lift its top ring, then tap the rod where it should go. You can also swipe from one rod to another. On a keyboard, number keys 1–7 pick rods and Esc puts a ring back. Every colour also has a shape (circle, triangle, square, diamond or cross), so the game works for colour-blind players.

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
| Two-player protocol (host decides the winner) | `src/net/match.ts` |
| PeerJS and test transports | `src/net/transport.ts` |
| Screens and interaction | `src/main.ts`, `src/ui/` |
