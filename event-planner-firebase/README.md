# Event Planner (Firebase + React + Vite + TS)

A lightweight event planner (tasks, subtasks, progress bars, drag‑and‑drop assignees) with **Firebase Auth + Firestore realtime**. Frontend-only — perfect for GitHub Pages.

## 1) Download & Install
1. Unzip this folder.
2. Install Node.js (v18+ recommended).
3. In the project folder, run:
   ```bash
   npm install
   ```

## 2) Firebase Setup
1. Create a Firebase project → add a **Web App**.
2. Enable **Authentication** → turn on **Google** and **Anonymous** providers.
3. Enable **Firestore** (production or test mode).
4. Add your GitHub Pages domain in **Authentication → Settings → Authorized domains**.
5. Copy your web app config into `src/firebaseConfig.ts`:
   ```ts
   // create this file by copying firebaseConfig.example.ts
   export const firebaseConfig = {
     apiKey: '...',
     authDomain: 'YOUR_PROJECT.firebaseapp.com',
     projectId: 'YOUR_PROJECT_ID',
   }
   ```

### Firestore Security Rules (MVP)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /projects/{projectId}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
> Tighten later to restrict to project members.

## 3) Run Locally
```bash
npm run dev
```
Open the URL it prints (e.g. http://localhost:5173). Sign in with Google or continue as guest, then create tasks, subtasks, and drag team members onto tasks.

## 4) Deploy to GitHub Pages
This repo includes a GitHub Actions workflow to build & deploy.
1. Create a new GitHub repo and push these files.
2. Go to **Settings → Pages** and set **Source** = **GitHub Actions**.
3. On the next push to `main`, the site will deploy automatically to:
   `https://<your-username>.github.io/<repo-name>/`

> The workflow sets `VITE_BASE` during build so assets resolve under your repo path.

## 5) File Types (TS vs TSX)
- **React components:** `.tsx` (e.g., `src/App.tsx`)  
- **Pure TypeScript modules:** `.ts` (e.g., `src/firebaseConfig.ts`)  
- **Type declarations (optional):** `.d.ts`

## Customize
- Change the seeded team in `App.tsx` inside the first `useEffect`.
- Switch `PROJECT_ID` from `'default'` to any per-event slug.
- Add fields like `dueDate`, `status`, and a Kanban board.
