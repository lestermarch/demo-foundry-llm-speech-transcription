'use strict'

/**
 * azure-speech.js
 *
 * Calls the Azure Speech REST API
 * (POST /speechtotext/transcriptions:transcribe?api-version=2025-10-15)
 * supporting three transcription engines selectable at runtime:
 *
 *   fast – Default Speech model (diarisation, word timestamps, phrase list)
 *   llm  – LLM Speech enhanced mode (prompt-tuning, translation)
 *   mai  – MAI-Transcribe-1.5 (highest accuracy, no diarisation, preview)
 *
 * Authentication: DefaultAzureCredential (managed identity on Azure App Service,
 * env-var or CLI credentials locally). The token is cached in memory until
 * 60 seconds before expiry to avoid unnecessary round-trips.
 *
 * Node 22+ built-in fetch and FormData are used – no extra HTTP library needed.
 */

const { DefaultAzureCredential } = require('@azure/identity')

// ── In-memory token cache ────────────────────────────────────────────────────
let _cachedToken = null  // { token: string, expiresOnTimestamp: number }

/**
 * Returns a valid Bearer token for cognitiveservices.azure.com,
 * refreshing from Azure AD if the cached one is near expiry.
 *
 * @returns {Promise<string>}
 */
async function getBearerToken () {
  const now = Date.now()
  const safetyMarginMs = 60_000 // refresh 60 s before expiry

  if (_cachedToken && _cachedToken.expiresOnTimestamp > now + safetyMarginMs) {
    return _cachedToken.token
  }

  const credential = new DefaultAzureCredential()
  const tokenResponse = await credential.getToken(
    'https://cognitiveservices.azure.com/.default'
  )

  _cachedToken = {
    token: tokenResponse.token,
    expiresOnTimestamp: tokenResponse.expiresOnTimestamp
  }

  return _cachedToken.token
}

/**
 * Builds the `definition` object that is posted as the second multipart part.
 * The engine value controls which Azure Speech mode is activated:
 *
 *   fast – no enhancedMode (standard Speech model)
 *   llm  – enhancedMode.enabled = true, task = 'transcribe' (LLM Speech)
 *   mai  – enhancedMode.enabled = true, model = 'mai-transcribe-1.5'
 *
 * @param {string} engine  - One of 'fast' | 'llm' | 'mai'
 * @param {string} [locale] - Optional BCP-47 locale hint, e.g. 'en-GB'
 * @returns {object}
 */
function buildDefinition (engine, locale) {
  const def = {}
  if (locale && locale.trim()) def.locales = [locale.trim()]
  if (engine === 'llm') {
    def.enhancedMode = { enabled: true, task: 'transcribe' }
  } else if (engine === 'mai') {
    def.enhancedMode = { enabled: true, model: 'mai-transcribe-1.5' }
  }
  // engine === 'fast': no enhancedMode block
  return def
}

/**
 * Transcribes audio using the chosen Azure Speech engine.
 *
 * @param {object} opts
 * @param {Buffer}  opts.buffer         - Raw audio bytes
 * @param {string}  opts.mimetype       - MIME type (e.g. 'audio/wav', 'audio/webm')
 * @param {string}  [opts.originalname] - Original filename (used as the multipart filename)
 * @param {string}  [opts.locale]       - BCP-47 locale hint, e.g. 'en-GB'. Optional.
 * @param {string}  [opts.engine]       - 'fast' | 'llm' | 'mai'. Defaults to 'mai'.
 * @returns {Promise<{transcript: string, engine: string, phrases: object[]}>}
 */
async function transcribeAudio ({ buffer, mimetype, originalname, locale, engine } = {}) {
  const endpoint = process.env.SPEECH_ENDPOINT
  if (!endpoint) {
    throw Object.assign(
      new Error('SPEECH_ENDPOINT environment variable is not set. Check your .env file or App Service configuration.'),
      { status: 500 }
    )
  }

  const token = await getBearerToken()

  // Build the definition JSON for the chosen transcription engine
  const resolvedEngine = (engine === 'fast' || engine === 'llm' || engine === 'mai') ? engine : 'mai'
  const definition = buildDefinition(resolvedEngine, locale)

  // Build multipart/form-data using the Node 22 built-in FormData + Blob
  const formData = new FormData()
  formData.append(
    'audio',
    new Blob([buffer], { type: mimetype || 'audio/wav' }),
    originalname || 'audio.wav'
  )
  formData.append('definition', JSON.stringify(definition))

  // Construct the full API URL
  const apiVersion = '2025-10-15'
  const url = `${endpoint.replace(/\/$/, '')}/speechtotext/transcriptions:transcribe?api-version=${apiVersion}`

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
        // Do NOT set Content-Type – fetch sets it automatically with the correct boundary
      },
      body: formData
    })
  } catch (networkErr) {
    throw Object.assign(
      new Error(`Network error contacting Speech API: ${networkErr.message}`),
      { status: 502 }
    )
  }

  let data
  try {
    data = await response.json()
  } catch (_) {
    throw Object.assign(
      new Error(`Speech API returned a non-JSON response (HTTP ${response.status})`),
      { status: response.status }
    )
  }

  if (!response.ok) {
    const message = data?.error?.message ||
      data?.message ||
      `Speech API error (HTTP ${response.status})`
    throw Object.assign(new Error(message), {
      status: response.status,
      upstream: data
    })
  }

  // Extract the combined transcript and the raw phrases array.
  // combinedPhrases[0].text  – full concatenated text (all engines)
  // phrases                  – per-phrase objects; may include 'speaker' int for fast/diarised mode
  const transcript = data?.combinedPhrases?.[0]?.text ?? ''
  const phrases    = Array.isArray(data?.phrases) ? data.phrases : []

  return { transcript, engine: resolvedEngine, phrases }
}

module.exports = { transcribeAudio, buildDefinition }
