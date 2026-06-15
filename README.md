# Microsoft Foundry - MAI-Transcribe-1.5 Demo

A small end-to-end demo showcasing **MAI-Transcribe-1.5** — Microsoft's new speech-to-text model from the Microsoft AI Superintelligence team (public preview) — invoked through the Microsoft Foundry **LLM Speech** API. The same Foundry resource hosts GPT chat deployments that summarise the transcript, so the demo proves the **one-resource, multi-surface** pattern (no separate Speech resource, no separate OpenAI resource).

The app lets you:

1. **Upload a WAV** file *or* **record audio live** from your browser microphone.
2. Pick from three transcription engines and run the transcription:
   - **Fast Transcription** — classic Microsoft speech model.
   - **LLM Speech** — multimodal LLM-powered transcription.
   - **MAI-Transcribe 1.5** — Microsoft's new multilingual STT model (preview).
3. Pick from two LLMs and summarise the transcript:
   - `gpt-5.4`
   - `gpt-5.4-nano`

The frontend is built on the **GOV.UK Prototype Kit** (Node 22 LTS) for a fast, accessible UI.

---

## Why this exists

MAI-Transcribe-1.5 is **not** a model you deploy under a Foundry project — there is no model card to add and the Azure Speech SDK does not surface it. It is invoked via the Speech REST API on the parent AI Foundry (AIServices) resource, with an `enhancedMode.model` flag in the multipart `definition`:

```http
POST https://{account}.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15
Content-Type: multipart/form-data
Authorization: Bearer <Entra token for https://cognitiveservices.azure.com/.default>

audio=@meeting.wav
definition={"enhancedMode":{"enabled":true,"model":"mai-transcribe-1.5"}}
```

A single AI Foundry (AIServices) account exposes three surfaces, all under one managed identity:

| Surface | Hostname pattern | Used for |
| --- | --- | --- |
| Speech REST | `{account}.cognitiveservices.azure.com/speechtotext/...` | Fast / LLM Speech / MAI-Transcribe |
| Azure OpenAI | `{account}.openai.azure.com/openai/deployments/{name}/...` | `gpt-5.4`, `gpt-5.4-nano` (any OpenAI-format model) |
| Foundry inference | `{account}.services.ai.azure.com/models` | Non-OpenAI models (e.g. Mistral, Cohere, MAI inference models) |

This demo uses the first two. Authentication is **Entra ID only** — no API keys anywhere in the stack.

---

## Architecture

```
┌────────────────────┐     ┌──────────────────────────────────────────────────┐
│ Browser            │     │ Azure                                            │
│  - Upload WAV      │     │                                                  │
│  - MediaRecorder   │     │   ┌─────────────────────────────────────────┐    │
│    (mic capture)   │     │   │ App Service (Linux, Node 22)            │    │
└─────────┬──────────┘     │   │  GOV.UK Prototype Kit                   │    │
          │ multipart      │   │  POST /api/transcribe                   │    │
          │ POST           │   │  POST /api/summarise                    │    │
          ▼                │   └────────────┬────────────────────────────┘    │
   ──────────────  HTTPS ──┼──────────────┐ │ DefaultAzureCredential          │
                           │              │ │ (user-assigned MI)              │
                           │              ▼ ▼                                 │
                           │   ┌─────────────────────────────────────────┐    │
                           │   │ AI Foundry account (AIServices)         │    │
                           │   │   ├─ .cognitiveservices.azure.com       │    │
                           │   │   │     /speechtotext  ← Fast / LLM /   │    │
                           │   │   │                      MAI-Transcribe │    │
                           │   │   └─ .openai.azure.com                  │    │
                           │   │         /openai/deployments/gpt-5.4     │    │
                           │   │         /openai/deployments/gpt-5.4-nano│    │
                           │   └─────────────────────────────────────────┘    │
                           └──────────────────────────────────────────────────┘
```

---

## Repo layout

```
.
├─ azure.yaml              # azd service map (web → ./src on App Service)
├─ infra/
│   ├─ main.bicep          # subscription-scope deployment
│   ├─ main.parameters.json
│   └─ modules/
│       ├─ foundry.bicep   # AIServices account + project + model deployments
│       ├─ identity.bicep  # user-assigned managed identity
│       ├─ rbac.bicep      # Cognitive Services User + Azure AI User
│       └─ web.bicep       # App Service plan + Linux Node 22 site
└─ src/                    # GOV.UK Prototype Kit app
    ├─ app/                # routes, views, MediaRecorder client
    └─ lib/
        ├─ azure-speech.js # the three-engine transcription module
        └─ azure-ai.js     # the summarisation module (Azure OpenAI)
```

---

## Prerequisites

- **Azure subscription** in a tenant that has access to the MAI-Transcribe preview, with quota for AIServices in a [supported region](https://learn.microsoft.com/azure/ai-services/speech-service/regions) and capacity for the chosen GPT models.
- **Azure CLI** ≥ 2.62 (`az login`).
- **azd** ≥ 1.10 (`azd version`).
- **Node.js 22 LTS** for local dev of the web app.
- A modern Chromium browser (Edge / Chrome) for the microphone capture page (MediaRecorder).

---

## Region selection

MAI-Transcribe-1.5 is currently only available in **`eastus`**, **`northeurope`**, **`southeastasia`** and **`westus`**. The demo defaults to **`southeastasia`** because:

- It hosts the full GPT-5 family (so a single Foundry resource covers both surfaces).
- It typically has spare App Service B1 quota in MCAPS-Internal sandboxes; the other regions often hit `InternalSubscriptionIsOverQuotaForSku` on the App Service plan.

To pick a different region, edit the `@allowed` list in `infra/main.bicep` and run `azd env set AZURE_LOCATION <region>` before `azd up`. **`northeurope` does not host the GPT-5 family in most subscriptions** — if you want it for speech you'll need a second Foundry resource elsewhere for the LLMs.

---

## Deploy

```powershell
azd auth login
azd env new mai-transcribe-demo
azd env set AZURE_LOCATION southeastasia
azd up
```

`azd up` provisions everything and deploys the web app. When it finishes you'll see a `WEB_URI` output — open that in a browser.

Redeploy code only after editing `src/`:

```powershell
azd deploy web
```

Tear it all down:

```powershell
azd down --purge
```

The `--purge` is important: AIServices accounts soft-delete by default, which blocks re-creation under the same name.

---

## Configuration

The Bicep wires the App Service with these app settings (also handy for local `.env` testing):

| Setting | Example | Purpose |
| --- | --- | --- |
| `SPEECH_ENDPOINT` | `https://aif-abcd1234.cognitiveservices.azure.com` | Base URL for the Speech REST call |
| `FOUNDRY_INFERENCE_ENDPOINT` | `https://aif-abcd1234.openai.azure.com` | Base URL for chat completions (Azure OpenAI surface) |
| `AVAILABLE_MODELS` | `gpt-5.4,gpt-5.4-nano` | Comma-separated allow-list shown on the summarise page |
| `AZURE_CLIENT_ID` | (GUID) | Client ID of the user-assigned MI for `DefaultAzureCredential` |
| `NODE_ENV` | `development` | Disables the Prototype Kit password gate (this is a public demo) |
| `IS_UNRESTRICTED` | `true` | Belt-and-braces: tells the kit it may run without a password |
| `WEBSITES_CONTAINER_START_TIME_LIMIT` | `600` | First-boot `npm install` can take ~3 minutes on B1 |

To change which LLMs are offered, edit the `models` array in `infra/main.bicep` and re-run `azd provision`. The `AVAILABLE_MODELS` setting on the App Service is regenerated from that array on every deploy.

---

## Local development

```powershell
cd src
npm install
$env:SPEECH_ENDPOINT          = (azd env get-values | Select-String '^SPEECH_ENDPOINT').ToString().Split('=')[1].Trim('"')
$env:FOUNDRY_INFERENCE_ENDPOINT = (azd env get-values | Select-String '^FOUNDRY_INFERENCE_ENDPOINT').ToString().Split('=')[1].Trim('"')
$env:AVAILABLE_MODELS         = "gpt-5.4,gpt-5.4-nano"
npm run dev
```

`DefaultAzureCredential` will use your `az login` identity locally. `azd up` grants the deploying user `Cognitive Services User` on the account and `Azure AI User` on the project, so calls succeed without further setup.

---

## Demo script

1. Open the deployed site → **Start**.
2. Choose **Upload a WAV file**, pick a short clip (≤ 5 mins, ≤ 300 MB).
3. Pick a transcription engine — try all three to compare:
   - **Fast** — speaker labels (diarization), word-level timestamps.
   - **LLM Speech** — punctuation, formatting, multilingual.
   - **MAI-Transcribe 1.5** — Microsoft's latest STT, multilingual, no diarization.
4. Pick **`gpt-5.4`** → **Summarise**. The summary comes back from the OpenAI surface on the same Foundry resource.
5. Go back, this time **Record from microphone**. Speak for ~20 s, stop, **Use this recording**. Same flow.
6. Show the audience the Azure portal: a single AI Foundry resource, project with the two GPT deployments, and **no separate Speech or OpenAI resource**.

---

## Where the interesting code lives

- **Three-engine transcription** — `src/lib/azure-speech.js`
  - `buildDefinition(engine, locale)` is the entire branching logic in ~10 lines.
  - `transcribeAudio()` wraps it with multipart construction and a single Entra-authenticated `fetch` to the `cognitiveservices.azure.com` host.
- **Summarisation** — `src/lib/azure-ai.js`
  - Direct `fetch` to `{account}.openai.azure.com/openai/deployments/{model}/chat/completions`.
  - Cached MI token via `@azure/identity` (`DefaultAzureCredential`).
  - Note: gpt-5.x rejects `max_tokens` (use `max_completion_tokens`) and does not allow `temperature` overrides — the code reflects this.

---

## Known limitations

- **MAI-Transcribe-1.5 is in public preview** — no SLA, behaviour may change.
- MAI-Transcribe does **not** support diarization, word-level timestamps, or custom prompting (see the [feature matrix](https://learn.microsoft.com/azure/ai-services/speech-service/mai-transcribe)).
- The app proxies audio server-side; secrets/tokens never reach the browser. Audio is held in memory only and not persisted.
- The demo runs without any auth gate (it's intended to be quickly torn down). Don't leave it running long-term against a real subscription.

---

## References

- [MAI-Transcribe in LLM Speech API](https://learn.microsoft.com/azure/ai-services/speech-service/mai-transcribe)
- [LLM Speech API overview](https://learn.microsoft.com/azure/ai-services/speech-service/llm-speech)
- [Fast transcription API](https://learn.microsoft.com/azure/ai-services/speech-service/fast-transcription-create)
- [Speech service regions](https://learn.microsoft.com/azure/ai-services/speech-service/regions)
- [GOV.UK Prototype Kit](https://prototype-kit.service.gov.uk/docs/)
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
