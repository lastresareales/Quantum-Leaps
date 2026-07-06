<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Quantum-Leaps

Vite + React + TypeScript app generated from Google AI Studio, with Firebase-related config and rules included in the repo.

AI Studio app link: https://ai.studio/apps/f395f060-be27-46d3-b822-5064c25974c1

## Run locally

Prerequisite: Node.js (LTS recommended)

1. Install dependencies:
   `npm install`
2. Create your env file from the example:
   `cp .env.example .env.local`
3. Set `GEMINI_API_KEY` in `.env.local`
4. Start development server:
   `npm run dev`

## Scripts

- `npm run dev`: Start Vite dev server on port 3000, bound to `0.0.0.0`
- `npm run build`: Create a production build in `dist/`
- `npm run preview`: Preview the production build locally
- `npm run clean`: Remove the `dist/` output directory
- `npm run lint`: Type-check the project with TypeScript (`tsc --noEmit`)

## Project tree

```text
.
├── .env.example
├── .gitignore
├── README.md
├── firebase-applet-config.json
├── firebase-blueprint.json
├── firestore.rules
├── index.html
├── metadata.json
├── package-lock.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src
    ├── App.tsx
    ├── index.css
    ├── main.tsx
    ├── components
    │   └── TerminalSandbox.tsx
    └── lib
        ├── firebase.ts
        └── gemini.ts
```
