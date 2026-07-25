# SpaceHo2 🤠

A browser-based tribute to the classic 4X strategy game **Spaceward Ho!**
Pure HTML5 canvas + vanilla JavaScript — no build step, no dependencies.

## Play

Open `index.html` in a browser — it is fully self-contained, so downloading
that single file is enough.

You command the blue empire against three AI rivals. Last empire standing wins.

Press **Ho!** (or <kbd>Enter</kbd>) to end your turn, <kbd>Esc</kbd> to cancel a
fleet order. Add `#seed=1234` to the URL to replay a specific galaxy.

## How it works

- **Planets** have a temperature, gravity, and metal reserves. How well your
  people thrive on a planet (its *suitability*) depends on how close it is to
  your homeworld's ideal temperature and gravity. Suitability drives population
  growth and income.
- **Terraforming** moves a planet's temperature toward your ideal — gravity is
  forever. **Mining** converts reserves into metal for shipbuilding; when your
  stockpile runs dry, the galactic market sells metal at a steep markup.
- **Research** has six tracks: Range, Speed, Weapons, Shields,
  Miniaturization (cheaper ships), and Radical (cheaper research). Ships keep
  the tech levels they were *built* with, so old hulls grow obsolete.
- **Ships**: Scouts explore and refresh intel, Colony Ships settle uninhabited
  worlds, Satellites defend in place, and Fighters / Destroyers / Dreadnoughts
  fight. Combat is automatic when rival fleets share a system; warships
  orbiting an undefended enemy world bombard its population.
- **Fog of war**: you only see live data where you have a planet or ship;
  everywhere else you see the last survey (dashed rings on the map).

## The map

The star map is drawn on an animated canvas that scales to the window at
device resolution. Its visual language:

- **Points of light** are systems you have not surveyed yet — you can see the
  star, but nothing about its world.
- **Lit spheres** are surveyed planets, shaded by temperature: icy blues
  through temperate greens to molten reds, with polar caps on cold worlds and
  city lights on the night side of populated ones.
- **A coloured ring** marks the owning empire — solid where you have live
  intelligence, dashed where you are going on an old survey. The ring sits on
  top of the planet's own glow so a red empire on a hot world still reads as
  owned.
- Your worlds wear the traditional hat. Chevrons beside a planet count the
  ships parked there.
- Fleets you have dispatched glide along dashed courses with engine trails;
  battles, bombardments and new colonies burst on the map as they happen.

## Development

The sources live in `css/` and `js/`; `dev.html` loads them directly for
development. `index.html` is generated from them — after editing, rebuild it:

```sh
node build.js
```

The model (`js/model.js`, `js/ai.js`, `js/data.js`) is DOM-free and testable
headless:

```sh
node test/smoke.js                 # simulates full AI-vs-AI games
npm install --no-save jsdom
node test/ui.test.js               # rebuilds index.html and drives the UI in jsdom
```
