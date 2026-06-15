'use strict'

/**
 * azure-ai.js
 *
 * Calls the Azure AI Foundry inference endpoint via the
 * @azure-rest/ai-inference package to summarise a transcript.
 *
 * The model name must appear in the AVAILABLE_MODELS environment variable
 * (comma-separated). If it does not, a 400 error is thrown before any
 * network call is made.
 *
 * Authentication: DefaultAzureCredential (same identity as azure-speech.js).
 */

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
 * Summarises a transcript using an Azure AI Foundry chat-completions model.
 *
 * @param {object} opts
 * @param {string} opts.transcript  - Full transcript text
 * @param {string} opts.model       - Model deployment name (must be in AVAILABLE_MODELS)
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

  // Lazy-require the Azure AI Inference SDK.
  // @azure-rest/ai-inference uses a default export (factory function).
  const aiInferenceModule = require('@azure-rest/ai-inference')
  const ModelClient = aiInferenceModule.default || aiInferenceModule

  const { DefaultAzureCredential } = require('@azure/identity')

  const client = ModelClient(
    endpoint,
    new DefaultAzureCredential(),
    {
      // Tell the Azure pipeline which audience to request a token for.
      credentialScopes: ['https://cognitiveservices.azure.com/.default']
    }
  )

  let response
  try {
    response = await client.path('/chat/completions').post({
      body: {
        model: model,
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
        max_tokens: 800,
        temperature: 0.3
      }
    })
  } catch (networkErr) {
    throw Object.assign(
      new Error(`Network error contacting inference endpoint: ${networkErr.message}`),
      { status: 502 }
    )
  }

  // Azure REST client returns status as a string
  const statusCode = parseInt(response.status, 10)
  if (statusCode < 200 || statusCode >= 300) {
    const message = response.body?.error?.message ||
      `Inference API error (HTTP ${response.status})`
    throw Object.assign(new Error(message), { status: statusCode })
  }

  const content = response.body?.choices?.[0]?.message?.content
  if (!content) {
    throw Object.assign(
      new Error('Inference API returned an empty response'),
      { status: 502 }
    )
  }

  return content
}

module.exports = { summariseTranscript, getAvailableModels }
