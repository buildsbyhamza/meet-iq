# 🚀 Vercel Deployment Guide for MeetIQ

MeetIQ is fully configured for serverless deployment on **Vercel**.

---

## ⚡ Option 1: Deploy using Vercel CLI (Recommended)

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. **Deploy to Vercel**:
   Run the following command from the project root:
   ```bash
   vercel
   ```

3. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

---

## 🐙 Option 2: Deploy via GitHub / Vercel Web Dashboard

1. **Push your code to GitHub / GitLab / Bitbucket**.
2. Go to [https://vercel.com/new](https://vercel.com/new).
3. Import your **MeetIQ** repository.
4. **Environment Variables**: Add the following in Vercel Project Settings $\rightarrow$ Environment Variables:
   - `NVIDIA_API_KEY` (e.g. `nvapi-...`)
   - `GROK_API_KEY` (Optional)
   - `GEMINI_API_KEY` (Optional)
   - `JWT_SECRET` (e.g. `meetiq-production-secret-2026`)
5. Click **Deploy**. Vercel will automatically build and publish your app!

---

## 🛠️ Included Vercel Configuration Files:
- `vercel.json` — Vercel Serverless Routing & Static Asset handling.
- `api/index.js` — Serverless Node.js Express entrypoint.
- `server/db.js` — Auto `/tmp` directory & in-memory fallback for Vercel read-only filesystem.
- `server/server.js` — Auto `/tmp/uploads` file handling.
