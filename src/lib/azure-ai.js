'use strict'

/**
 * azure-ai.js
 *
 * Calls the Azure OpenAI chat-completions endpoint exposed on the same
 * Foundry account that hosts the Speech surface (one account, two surfaces).
 *
 * Why not the Azure AI Inference / model-router endpoint?
 *   The OpenAI gpt-5.x models deployed here are OpenAI-format only and aren't
 *   served by the {account}.services.ai.azure.com/models surface — that path
 *   returns 401/404 for them. The OpenAI-flavoured surface at
 *   {account}.openai.azure.com/openai/deployments/{deployment}/chat/completions
 *   accepts the same managed-identity bearer token.
 *
 * gpt-5.x quirks: max_tokens is rejected (use max_completion_tokens) and
 * the temperature parameter must be omitted (only the default is supported).
 *
 * The model name must appear in the AVAILABLE_MODELS environment variable
 * (comma-separated). If it does not, a 400 error is thrown before any
 * network call is made.
 *
 * Authentication: DefaultAzureCredential (same identity as azure-speech.js).
 */

const OPENAI_API_VERSION = '2024-10-21'
const TOKEN_SCOPE = 'https://cognitiveservices.azure.com/.default'
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

let cachedToken = null
let cachedTokenExpiry = 0
let credentialSingleton = null

function getCredential () {
  if (!credentialSingleton) {
    const { DefaultAzureCredential } = require('@azure/identity')
    credentialSingleton = new DefaultAzureCredential()
  }
  return credentialSingleton
}

async function getAccessToken () {
  const now = Date.now()
  if (cachedToken && now < cachedTokenExpiry - TOKEN_REFRESH_SKEW_MS) {
    return cachedToken
  }
  const credential = getCredential()
  const tokenResponse = await credential.getToken(TOKEN_SCOPE)
  if (!tokenResponse || !tokenResponse.token) {
    throw Object.assign(
      new Error('Failed to acquire access token for Azure OpenAI'),
      { status: 500 }
    )
  }
  cachedToken = tokenResponse.token
  cachedTokenExpiry = tokenResponse.expiresOnTimestamp
  return cachedToken
}

/**
 * Returns the list of permitted model names from env, trimmed and non-empty.
 * @returns {string[]}
 */
function getAvailableModels () {
  return (process.env.AVAILABLE_MODELS || '')
    .split(',')
    .map(function (m) { return m.trim() })
    .filter(Boolean)
}

/**
 * Summarises a transcript using an Azure OpenAI chat-completions deployment.
 *
 * @param {object} opts
 * @param {string} opts.transcript  - Full transcript text
 * @param {string} opts.model       - Deployment name (must be in AVAILABLE_MODELS)
 * @returns {Promise<string>}       - The summary text from the model
 */
async function summariseTranscript ({ transcript, model } = {}) {
  if (!transcript || !transcript.trim()) {
    throw Object.assign(new Error('No transcript provided'), { status: 400 })
  }
  if (!model || !model.trim()) {
    throw Object.assign(new Error('No model specified'), { status: 400 })
  }

  const availableModels = getAvailableModels()
  if (availableModels.length === 0) {
    throw Object.assign(
      new Error(
        'Server configuration error: AVAILABLE_MODELS is not set. ' +
        'Add it to your .env file or App Service application settings.'
      ),
      { status: 500 }
    )
  }
  if (!availableModels.includes(model)) {
    throw Object.assign(
      new Error(`Model '${model}' is not in the list of permitted models`),
      { status: 400 }
    )
  }

  const endpoint = process.env.FOUNDRY_INFERENCE_ENDPOINT
  if (!endpoint) {
    throw Object.assign(
      new Error('FOUNDRY_INFERENCE_ENDPOINT environment variable is not set.'),
      { status: 500 }
    )
  }

  const baseUrl = endpoint.replace(/\/+$/, '')
  const url = `${baseUrl}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${OPENAI_API_VERSION}`

  const token = await getAccessToken()

  const body = {
    messages: [
      {
        role: 'system',
        content: [
          'You are a helpful assistant that summarises audio transcripts.',
          'Summarise the following transcript in plain English.',
          'Use UK English spelling and grammar.',
          'Structure your response as:',
          '1. A brief 2–3 sentence overview.',
          '2. A bulleted list of the key points.',
          'Be concise and factual. Do not add information not present in the transcript.'
        ].join(' ')
      },
      {
        role: 'user',
        content: transcript
      }
    ],
    max_completion_tokens: 800
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  } catch (networkErr) {
    throw Object.assign(
      new Error(`Network error contacting inference endpoint: ${networkErr.message}`),
      { status: 502 }
    )
  }

  let payload = null
  try {
    payload = await response.json()
  } catch (_parseErr) {
    payload = null
  }

  if (!response.ok) {
    const message = payload?.error?.message ||
      `Inference API error (HTTP ${response.status})`
    throw Object.assign(new Error(message), { status: response.status })
  }

  const content = payload?.choices?.[0]?.message?.content
  if (!content) {
    throw Object.assign(
      new Error('Inference API returned an empty response'),
      { status: 502 }
    )
  }

  return content
}

module.exports = { summariseTranscript, getAvailableModels }
