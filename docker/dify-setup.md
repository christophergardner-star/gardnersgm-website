# Dify AI Chatbot — Setup Guide

> **Time required:** ~10 minutes  
> **Prerequisites:** Docker stack running (`docker-compose up -d`)

---

## 1. Access Dify Dashboard

Open your browser and go to:
```
http://localhost:3000
```

Create your admin account when prompted.

---

## 2. Add Ollama as Model Provider

1. Go to **Settings** (gear icon, top-right)
2. Click **Model Providers**
3. Click **Add Model Provider** → **Ollama**
4. Set the connection:
   - **Base URL:** `http://host.docker.internal:11434`
   - **Model Name:** `llama3.2` (or whatever you have installed)
   - **Model Type:** LLM
5. Click **Save**
6. Test the connection — should show ✅

---

## 3. Create the GGM Assistant App

1. Go to **Studio** → **Create App**
2. Choose **Chat App**
3. Name it: `GGM Assistant`
4. Description: `AI assistant for Gardners Ground Maintenance website visitors`

### Configure the App:

**System Prompt:**
```
You are the AI assistant for Gardners Ground Maintenance (GGM), a professional 
garden care company based in Cornwall, UK, run by Chris Gardner.

Key facts:
- Services: lawn mowing, hedge trimming, garden clearance, landscaping, 
  pressure washing, fencing, tree surgery, planting, and subscription garden care
- Coverage: All of Cornwall (St Austell, Truro, Falmouth, Newquay, Bodmin, etc.)
- Phone: 01726 432051
- Email: enquiries@gardnersgm.co.uk  
- Website: gardnersgm.co.uk
- Subscription plans: Basic, Premium, Professional (regular scheduled visits)

Guidelines:
- Be friendly, professional, and helpful
- Use British English
- Keep answers concise (2-3 paragraphs max)
- If asked about booking, direct them to gardnersgm.co.uk/booking
- If asked about pricing, give general ranges but suggest getting a personalised quote
- Never make up information about services or pricing you're not sure about
- If you can't answer, suggest they contact Chris directly
```

**Model:** Select your Ollama model (llama3.2)  
**Temperature:** 0.7  
**Max Tokens:** 512

---

## 4. Upload Knowledge Base

1. In your app, click **Knowledge** in the left sidebar
2. Click **Create Knowledge Base**
3. Name it: `GGM Business Info`
4. Click **Upload Documents**
5. Upload these files from your computer:
   - `D:\gardening\admin\BUSINESS_PLAN.md` ← **Most important**
   - Optionally: copy/paste your services page content
   - Optionally: copy/paste your FAQ content
6. Dify will automatically chunk and embed the documents
7. Wait for processing to complete (usually < 1 minute)

### Connect Knowledge to App:
1. Go back to **Studio** → **GGM Assistant**  
2. In the **Context** section, add your `GGM Business Info` knowledge base
3. This enables RAG (Retrieval Augmented Generation) — the AI will 
   search your business docs before answering

---

## 5. Get API Key

1. Go to **Studio** → **GGM Assistant**
2. Click **Access API** (top-right)
3. Click **API Key** → **Create**
4. Copy the API key
5. Add it to your Docker `.env` file:
   ```
   DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
   ```
6. Also add it to your main `.env` file:
   ```
   DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
   ```

---

## 6. Test the Integration

### Test via Dify UI:
- Click **Preview** in the app builder
- Ask: "What services do you offer?"
- Should get a knowledgeable answer about GGM services

### Test via API:
```bash
curl -X POST http://localhost:5001/v1/chat-messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What gardening services do you offer?", "user": "test-user", "inputs": {}}'
```

### Test on website:
- Open your website
- Chat with the bot
- FAQ keywords still work as before
- General questions now route to Dify AI
- Unanswered questions still fall through to Telegram

---

## How It Works (Technical)

```
User types message in chatbot
         │
         ▼
  ┌─── Booking flow active? ──→ Continue booking steps
  │
  ├─── Bespoke enquiry active? ──→ Continue enquiry steps
  │
  ├─── Subscription code? ──→ Subscription portal
  │
  ├─── FAQ keyword match? ──→ Show FAQ answer (instant)
  │
  ├─── Dify API call ──→ AI-generated answer (2-5 sec)
  │         │
  │         ├── Good answer → Show to user
  │         └── Error/empty → Fall through ↓
  │
  └─── Telegram relay ──→ Chris answers live (human fallback)
```

The chatbot prioritises deterministic answers (FAQ, booking flows)
over AI, and keeps human fallback as the last resort.

---

## Maintenance

- **Update knowledge base:** Re-upload BUSINESS_PLAN.md whenever it changes
- **n8n auto-sync:** The `ggm-dify-knowledge-sync.json` workflow automatically 
  updates Dify's knowledge base weekly with latest services/pricing from Google Sheets
- **Monitor usage:** Check Dify dashboard → **Logs** for conversation history
- **Cost-free:** Runs entirely on your local Ollama — no API fees

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dify can't connect to Ollama | Check `http://host.docker.internal:11434` is accessible from Docker |
| Slow responses | Try a smaller Ollama model (llama3.2 vs llama3.1:70b) |
| Generic answers | Upload more documents to the knowledge base |
| Chatbot not routing to Dify | Check `DIFY_API_KEY` is set in `.env` |
| Container won't start | Run `docker-compose logs dify-api` to check errors |
