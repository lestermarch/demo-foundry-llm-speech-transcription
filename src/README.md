# MAI-Transcribe Demo

A GOV.UK Prototype Kit application that demonstrates **Microsoft MAI-Transcribe-1.5** — a new speech-to-text model in public preview on Azure AI Foundry — combined with LLM-based transcript summarisation.

Built with [GOV.UK Prototype Kit](https://prototype-kit.service.gov.uk/) 13.x, [GOV.UK Frontend](https://frontend.design-system.service.gov.uk/) 5.x, and the Azure AI SDK for JavaScript.

> **This is a demonstration prototype.** It uses a preview API with no SLA. Do not use it for production workloads or upload sensitive data.

---

## What the prototype does

1. **Start page** – Overview and "Start now" button.
2. **Choose** – Select "Upload a WAV file" or "Record from microphone".
3. **Upload / Record** – Choose a transcription engine (see below), optionally hint a locale, then provide audio.
4. **Transcript** – Shows the transcription result with a `govuk-tag` identifying the engine used. If the engine returned speaker-diarised phrases (Fast Transcription), the transcript is shown as a labelled speaker-turn list. Otherwise it is shown as a single text block.
5. **Summarise** – Pick an LLM and generate a plain-English summary with key bullet points.
6. **Summary** – Shows the model's output alongside the original transcript in a collapsible `govuk-details` section.

---

## Transcription engines

All three engines call the same Azure Speech REST endpoint
(`POST /speechtotext/transcriptions:transcribe`) — only the `definition` multipart
part differs. See the
[feature availability matrix](https://learn.microsoft.com/azure/ai-services/speech-service/llm-speech#feature-availability)
for a full comparison.

| Engine value | Label in UI | `definition` sent | Notable capabilities |
|---|---|---|---|
| `fast` | Fast Transcription | _(no `enhancedMode`)_ | Diarisation, word-level timestamps, phrase list |
| `llm` | LLM Speech (enhanced) | `enhancedMode: { enabled: true }` | GPT-powered, prompt-tuning, translation |
| `mai` | MAI-Transcribe-1.5 *(default)* | `enhancedMode: { enabled: true, model: "mai-transcribe-1.5" }` | Highest accuracy on noisy audio; preview; no diarisation |

The `AVAILABLE_MODELS` env var and all summarisation logic are **unchanged** — engine choice only affects the transcription step.

---

## Prerequisites

- **Node.js 22 LTS** (`node --version` should show `v22.x.x`)
- An **Azure AI Foundry** resource with:
  - The LLM Speech API enabled (MAI-Transcribe-1.5 in enhanced mode)
  - One or more chat-completions model deployments for summarisation
- Azure credentials that have the **Cognitive Services User** role on the resource  
  (or your user account has that role and you are signed in via `az login`)

---

## Running locally

### 1. Clone / copy the `src/` folder

```bash
cd path/to/src
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in the values:

| Variable | Description |
|---|---|
| `SPEECH_ENDPOINT` | Base URL of your Azure Cognitive Services / AI Foundry resource, e.g. `https://my-resource.cognitiveservices.azure.com` |
| `FOUNDRY_INFERENCE_ENDPOINT` | Inference URL, e.g. `https://my-resource.services.ai.azure.com/models` |
| `AVAILABLE_MODELS` | Comma-separated deployment names, e.g. `gpt-5.5,gpt-5.4-nano` |

Authentication uses `DefaultAzureCredential`. For local development the easiest option is to run `az login` with an account that has the **Cognitive Services User** role on your Foundry resource.

### 4. Start the development server

```bash
npm run dev
```

The kit opens at **http://localhost:3000**.  
Use `npm start` to run in production mode (builds CSS then starts Express on `process.env.PORT`).

---

## Deploying to Azure App Service (Linux, Node 22)

### Required App Service application settings

Set these in **Configuration → Application settings** (full table including the required `PASSWORD` setting is in the [password protection section](#prototype-kit-password-protection-required-in-production) below):

| Setting | Required | Notes |
|---|---|---|
| `SPEECH_ENDPOINT` | Yes | `https://<resource>.cognitiveservices.azure.com` |
| `FOUNDRY_INFERENCE_ENDPOINT` | Yes | `https://<resource>.services.ai.azure.com/models` |
| `AVAILABLE_MODELS` | Yes | Comma-separated deployment names, e.g. `gpt-5.5,gpt-5.4-nano` |
| `NODE_ENV` | Yes | Set to `production` |
| `USE_HTTPS` | Yes | Set to `false` (TLS terminated externally by App Service) |
| `PASSWORD` | **Yes** | Any value — see warning below |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | Yes | Set to `true` |

### Start command

Azure App Service runs `npm start`, which executes `govuk-prototype-kit serve`. This command:

1. Builds the CSS from Sass.
2. Starts the Express server on `process.env.PORT` (set automatically by App Service).

### Identity / authentication

Use a **system-assigned managed identity** on the App Service and grant it the **Cognitive Services User** role on the Azure AI Foundry resource. `DefaultAzureCredential` picks this up automatically — no secrets in config.

### Prototype Kit password protection (**required** in production)

> ⚠️ **Without `PASSWORD`, all page routes return a "Password not set" error when `NODE_ENV=production`.** The prototype will not be usable.

The kit's built-in basic-auth middleware gates every route (except the management interface) in production mode. Add `PASSWORD` to the App Service application settings table:

| Setting | Value |
|---|---|
| `SPEECH_ENDPOINT` | `https://<resource>.cognitiveservices.azure.com` |
| `FOUNDRY_INFERENCE_ENDPOINT` | `https://<resource>.services.ai.azure.com/models` |
| `AVAILABLE_MODELS` | `gpt-5.5,gpt-5.4-nano` (your model deployments) |
| `NODE_ENV` | `production` |
| `USE_HTTPS` | `false` – Azure App Service terminates TLS externally; the kit must not try to redirect internally |
| `PASSWORD` | A strong password to protect the prototype. **Required** — the kit blocks all routes without it in production. |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |

### Find your endpoints

In the [Azure AI Foundry portal](https://ai.azure.com):

1. Open your project → **Settings** → **Connected resources**.
2. The **Speech** endpoint is the Cognitive Services URL: `https://<name>.cognitiveservices.azure.com`.
3. The **inference** endpoint is listed under **Endpoints**: `https://<name>.services.ai.azure.com/models`.

### Find your model deployment names

1. Go to **Deployments** in the Foundry portal.
2. Copy the deployment names (e.g. `gpt-5.5`, `gpt-5.4-nano`).
3. Set these as a comma-separated list in `AVAILABLE_MODELS`.

---

## Architecture

```
Browser                      Node.js (Prototype Kit / Express)          Azure
──────────                   ─────────────────────────────────          ─────
GET /upload           →      render upload.html
POST /upload          →      multer → lib/azure-speech.js        →      Speech API
  (multipart WAV)     ←      session.transcript = result         ←      { combinedPhrases }
  302 /result

GET /record           →      render record.html
  [MediaRecorder JS]
POST /api/transcribe  →      multer → lib/azure-speech.js        →      Speech API
  (multipart blob)    ←      session.transcript = result; JSON   ←      { combinedPhrases }
  window.location=/result

POST /result          →      lib/azure-ai.js                     →      AI Inference API
  (form: model)       ←      session.summary = result            ←      { choices[0].message }
  302 /summary
```

---

## Known limitations

- **Preview API**: MAI-Transcribe-1.5 (`mai-transcribe-1.5`) is in **public preview** as of June 2026. The API shape, model name, and behaviour may change.
- **No SLA**: Preview services have no uptime or latency guarantees.
- **WAV only for file upload**: The upload form restricts to `.wav`. The Speech API does support other formats; extending this is a minor change.
- **Recording format**: The `MediaRecorder` API uses `audio/webm;codecs=opus` (Chrome/Edge default). The Azure Speech API accepts WebM/Opus. Safari may produce `audio/mp4` — the code attempts a fallback but Safari support is not tested.
- **200 MB in-memory cap on B1**: Audio files are held in Node.js memory for the duration of the transcription request (no disk writes). On an App Service B1 plan (1.75 GB RAM), a single 200 MB upload leaves limited headroom. For demo use this is fine; upgrade to B2/B3 or add streaming if you need larger files or concurrent users.
- **Prototype only**: Session data is stored in memory (Express session cookie). There is no database, no real authentication, and no persistent storage.
- **Single-user demo**: Concurrent users share nothing (sessions are isolated), but the token cache in `lib/azure-speech.js` is process-global. This is fine for a demo; a production service would need a proper credential-management layer.
- **No Welsh language localisation**: This prototype uses English only. A production service for Welsh users would need translated content and the `cy-GB` locale passed to the Speech API.

---

## Design history

| Date | Change | Reason |
|---|---|---|
| 2026-06-15 | Initial prototype created | First version for demo purposes |

*Update this table after each round of user research as evidence for GDS Service Standard point 12 (Make sure users succeed first time).*

---

## GOV.UK Design System components used

| Page | Components |
|---|---|
| Start | `govukButton` (start), `govukWarningText` |
| Choose | `govukRadios`, `govukErrorSummary`, `govukBackLink` |
| Upload | `govukFileUpload`, `govukButton`, `govukErrorSummary`, `govukBackLink` |
| Record | Custom JS UI; `govukBackLink`; error summary injected by JS |
| Result | `govukInsetText` (transcript), `govukRadios` (model picker), `govukErrorSummary`, `govukBackLink` |
| Summary | `govukNotificationBanner`, `govukDetails`, `govukButton`, `govukBackLink` |

Components sourced from [design-system.service.gov.uk](https://design-system.service.gov.uk/).
