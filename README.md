# Junk Drawer Arena

Snap a photo of any object at home. **Aholo Lux3D** turns it into a 3D model and splits it into its real parts. An AI agent (OpenAI gpt-6-luna) builds a fighter card for it. Then the fighters battle in a physics arena where hard hits break real parts off.

Built for the Manycore Aholo Global 3D AI Hackathon.

## How Lux3D is used (the game cannot work without it)
1. Photo goes to OUS upload, then Lux3D `img-to-3d` (G1-Turbo). Or text goes to `text-to-3d`.
2. The GLB goes to Lux3D `part-split`. Each real part (handle, lid, legs) becomes its own collider.
3. Parts have HP. When one breaks it flies off as debris. Real size and mass come from the agent card.

## Run it
```
npm install
copy .env.example .env      (then add your keys)
npm run check               (tests the keys)
npm run play                (build and serve on http://localhost:8787)
```
Open `http://localhost:8787` for the landing page. Sign in, then play at `/play.html`. Scan the QR code with a phone on the same Wi-Fi to add a fighter and to control it.

No keys yet? Press **Quick demo**. It runs with built in demo fighters.

## Keys (.env)
- `AHOLO_API_KEY` from labs.aholo.ai (needed for real 3D)
- `OPENAI_API_KEY` (optional, model `gpt-6-luna` builds the card from the photo and writes the match recap)

## Controls
Phone: Attack, Jump, Dodge buttons. Keyboard: Q W E (fighter 1), I O P (fighter 2). Fighters fight on their own when nobody presses anything.

## Useful commands
- `npm run seed` makes 4 text fighters through Lux3D
- `npm run simtest` runs a headless balance test
- `npm run dev` runs server and Vite with hot reload (open port 5173)

## Credits per fighter
Turbo model 1, part split 30. Set `LUX3D_PART_SPLIT=0` to save credits. The game then cuts the mesh into chunks by itself.
