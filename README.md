# MAI-Transcribe-1.5 on Microsoft Foundry — demo

A small end-to-end demo showcasing **MAI-Transcribe-1.5**, Microsoft's new speech-to-text model (public preview) exposed through the Microsoft Foundry **LLM Speech** API, paired with LLM summarisation on the same Foundry resource.

The app lets you:

1. **Upload a WAV** file *or* **record audio live** from your browser's microphone.
2. Transcribe it using `mai-transcribe-1.5`.
3. Pick an LLM (e.g. `gpt-4.1`, `gpt-4o-mini`) and have it summarise the transcript.

The frontend uses the **GOV.UK Prototype Kit** for a fast, accessible UI. Infra is provisioned with **azd** (Bicep) into **Sweden Central**, the supported preview region for MAI-Transcribe.

---

## Why this exists

MAI-Transcribe-1.5 is **not** a model you deploy under a Foundry project — there is no model card to add and the Speech SDK does not surface it. It is invoked via the Speech REST API on the parent AI Foundry (AIServices) resource, with an `enhancedMode.model` flag in the multipart `definition`:

```http
POST https://{account}.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15
Content-Type: multipart/form-data
Authorization: Bearer <entra-token for https://cognitiveservices.azure.com/.default>

audio=@meeting.wav
definition={"enhancedMode":{"enabled":true,"model":"mai-transcribe-1.5"}}
```

This demo proves the "one Foundry resource, two surfaces" pattern:

| Surface | URL on the AIServices account | Used for |
| --- | --- | --- |
| Speech REST | `https://{account}.cognitiveservices.azure.com/speechtotext/...` | MAI-Transcribe-1.5 |
| Foundry inference | `https://{account}.services.ai.azure.com/models` | GPT / Claude / other deployed chat models |

Both surfaces authenticate with the **same managed identity** (Entra ID, no keys).

---

## Architecture

```
┌────────────────────┐     ┌──────────────────────────────────────────┐
│ Browser            │     │ Azure                                    │
│  – Upload WAV      │     │                                          │
│  – MediaRecorder   │     │   ┌─────────────────────────────────┐    │
│    (mic capture)   │     │   │ App Service (Linux, Node 22)    │    │
└─────────┬──────────┘     │   │  GOV.UK Prototype Kit app       │    │
          │ multipart      │   │  POST /api/transcribe           │    │
          │ POST           │   │  POST /api/summarise            │    │
          ▼                │   └────────────┬────────────────────┘    │
   ──────────────  HTTPS ──┼──────────────┐ │ DefaultAzureCredential  │
                           │              │ │ (user-assigned MI)      │
                           │              ▼ ▼                         │
                           │   ┌─────────────────────────────────┐    │
                           │   │ AI Foundry resource (AIServices)│    │
                           │   │  ├─ /speechtotext   ← MAI       │    │
                           │   │  └─ Foundry project             │    │
                           │   │      └─ /models ← gpt-4.1, etc. │    │
                           │   └─────────────────────────────────┘    │
                           └──────────────────────────────────────────┘
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
└─ src/                    # GOV.UK Prototype Kit app (Node 22)
```

---

## Prerequisites

- **Azure subscription** with quota for AIServices in **Sweden Central** and for the chosen GPT models.
- **Azure CLI** ≥ 2.62 (`az login`).
- **azd** ≥ 1.10 (`azd version`).
- **Node.js 22 LTS** for local dev of the web app.
- A modern Chromium browser (Edge / Chrome) for the microphone capture page (MediaRecorder).

---

## Deploy

```powershell
azd auth login
azd env new mai-transcribe-demo
azd env set AZURE_LOCATION swedencentral
azd env set PASSWORD "<choose a strong password>"
azd up
```

`azd up` provisions everything and deploys the web app. When it finishes you'll see the `WEB_URI` output — open that in a browser.

To redeploy code only after editing `src/`:

```powershell
azd deploy web
```

To tear it all down:

```powershell
azd down --purge
```

(The `--purge` is important: AIServices accounts soft-delete by default, which blocks re-creation under the same name.)

---

## Configuration

The Bicep wires the App Service with these app settings (also handy for local `.env` testing):

| Setting | Example | Purpose |
| --- | --- | --- |
| `SPEECH_ENDPOINT` | `https://aif-abcd1234.cognitiveservices.azure.com` | Base URL for the Speech REST call |
| `FOUNDRY_INFERENCE_ENDPOINT` | `https://aif-abcd1234.services.ai.azure.com/models` | Base URL for chat completions |
| `AVAILABLE_MODELS` | `gpt-5.4,gpt-5.4-nano` | Comma-separated list shown on the summarise page |
| `AZURE_CLIENT_ID` | (GUID) | Client ID of the user-assigned MI for `DefaultAzureCredential` |

To change which LLMs are offered, edit the `models` array in `infra/main.bicep` and re-run `azd provision`.

---

## Local development

```powershell
cd src
npm install
# point at the deployed Foundry resource:
$env:SPEECH_ENDPOINT = (azd env get-values | Select-String '^SPEECH_ENDPOINT').ToString().Split('=')[1].Trim('"')
$env:FOUNDRY_INFERENCE_ENDPOINT = (azd env get-values | Select-String '^FOUNDRY_INFERENCE_ENDPOINT').ToString().Split('=')[1].Trim('"')
$env:AVAILABLE_MODELS = "gpt-5.4,gpt-5.4-nano"
npm run dev
```

`DefaultAzureCredential` will use your `az login` identity locally. `azd up` grants the deploying user `Cognitive Services User` on the account and `Azure AI User` on the project, so calls should succeed without further setup.

---

## Demo script

1. Open the deployed site → **Start**.
2. Choose **Upload a WAV file**. Pick a short clip (≤ 5 mins is fine, ≤ 300 MB hard limit). Submit.
3. The transcript appears (one call to `/speechtotext/transcriptions:transcribe` with `enhancedMode.mai-transcribe-1.5`).
4. Pick **gpt-5.4** → **Summarise**. The summary streams back from the Foundry inference endpoint on the same resource.
5. Back to the start, this time **Record from microphone**. Speak for ~20 seconds, stop, **Use this recording**. Same flow.
6. Show the audience the Azure portal: a single AI Foundry resource, project with GPT deployments, no separate Speech resource.

---

## Known limitations

- **MAI-Transcribe-1.5 is in public preview** — no SLA, behaviour may change.
- Diarization, word-level timestamps and custom prompting are not supported by MAI-Transcribe (see the [feature matrix](https://learn.microsoft.com/azure/ai-services/speech-service/mai-transcribe)).
- The app sends audio to the server which proxies to Azure — secrets/tokens never reach the browser. Audio is held in memory only and not persisted.
- Region pinned to `swedencentral`. To use another region, check it's listed under `llmspeech` in the [Speech regions table](https://learn.microsoft.com/azure/ai-services/speech-service/regions) and update `AZURE_LOCATION`.

---

## References

- [MAI-Transcribe in LLM Speech API](https://learn.microsoft.com/azure/ai-services/speech-service/mai-transcribe)
- [LLM Speech API overview](https://learn.microsoft.com/azure/ai-services/speech-service/llm-speech)
- [Fast transcription API](https://learn.microsoft.com/azure/ai-services/speech-service/fast-transcription-create)
- [GOV.UK Prototype Kit](https://prototype-kit.service.gov.uk/docs/)
- [azd templates](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
