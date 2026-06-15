'use strict'

/**
 * app/routes.js – GOV.UK Prototype Kit routes for the MAI-Transcribe Demo.
 *
 * This file is required by the kit's server via utils.addRouters().
 * Each call to govukPrototypeKit.requests.setupRouter() creates an Express
 * Router and mounts it on the app as a side-effect – no export is required.
 *
 * Routes overview
 * ───────────────
 * GET  /          → Start page (index.html)
 * GET  /choose    → "Upload or record?" radio choice
 * POST /choose    → Validate choice, redirect to /upload or /record
 * GET  /upload    → File upload form
 * POST /upload    → Receive WAV file, call Azure Speech, redirect to /result
 * GET  /record    → MediaRecorder page (JS-enhanced)
 * GET  /result    → Show transcript + model picker for summarisation
 * POST /result    → Validate model choice, call Azure AI, redirect to /summary
 * GET  /summary   → Show transcript + summary
 *
 * API routes (called by browser JS on /record)
 * ────────────────────────────────────────────
 * POST /api/transcribe  → Accepts multipart audio blob + engine field, returns { transcript, engine, redirect }
 */

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()

const multer = require('multer')
const { transcribeAudio } = require('../lib/azure-speech')
const { summariseTranscript, getAvailableModels } = require('../lib/azure-ai')

// Multer configured with memory storage – no files are written to disk.
// Files live only in req.file.buffer during the request lifecycle.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024 // 200 MB – matches the hint text in upload.html
  }
})

// Valid transcription engine values
const VALID_ENGINES = new Set(['fast', 'llm', 'mai'])

// ── Helper: resolve + validate engine value ───────────────────────────────────
// Returns 'mai' when the field is absent or empty (safe default for no-JS/
// pre-checked radio).  Returns null when a value IS present but not in the
// allow-list — the caller must surface a validation error rather than silently
// coercing, so crafted requests with bogus values are rejected explicitly.
function resolveEngine (value) {
  if (!value || !value.trim()) return 'mai'       // absent / empty → default
  return VALID_ENGINES.has(value) ? value : null  // present → validate; null = rejected
}

// ── Multer error-handling wrappers ────────────────────────────────────────────
// Express does not catch errors thrown synchronously inside third-party
// middleware like multer. Wrapping upload.single() lets us intercept
// LIMIT_FILE_SIZE (and other multer errors) and produce the right response
// type for each route rather than sending an unhandled HTML error page.

// For form routes: re-renders the upload page with a GDS error summary.
// engine/locale fields are ordered before the file input in upload.html so
// req.body is already populated when a file-size error fires.
function multerFormMiddleware (req, res, next) {
  upload.single('audio')(req, res, function (err) {
    if (!err) return next()
    var code    = err.code || 'UPLOAD_ERROR'
    var message = code === 'LIMIT_FILE_SIZE'
      ? 'The file must be smaller than 200 MB. Choose a smaller WAV file.'
      : 'The file could not be uploaded: ' + (err.message || 'unknown error')
    var rawEngine = req.body && req.body.engine
    var engine    = (rawEngine && VALID_ENGINES.has(rawEngine)) ? rawEngine : 'mai'
    return res.render('upload', {
      engine,
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [{ text: message, href: '#audio' }]
      },
      errors: { audio: { text: message } }
    })
  })
}

// For API routes: returns JSON so browser JS (record.js) can parse the error.
function multerApiMiddleware (req, res, next) {
  upload.single('audio')(req, res, function (err) {
    if (!err) return next()
    var code       = err.code || 'UPLOAD_ERROR'
    var message    = code === 'LIMIT_FILE_SIZE'
      ? 'File too large. Maximum size is 200 MB.'
      : (err.message || 'File upload error')
    var httpStatus = code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return res.status(httpStatus).json({ error: message, code })
  })
}

// ── Helper: build radio items array for model picker ─────────────────────────
function buildModelItems (selectedModel) {
  return getAvailableModels().map(function (name) {
    return {
      value: name,
      text: name,
      checked: name === selectedModel
    }
  })
}

// ── Helper: safe redirect guard ───────────────────────────────────────────────
function hasTranscript (req) {
  return !!(req.session && req.session.data && req.session.data.transcript)
}

// ── Helper: transform raw phrases array for template rendering ────────────────
// Maps integer speaker IDs (0-based) to human-friendly labels ("Speaker 1").
// Filters out any phrases without text.
function formatPhrases (rawPhrases) {
  if (!Array.isArray(rawPhrases)) return []
  return rawPhrases
    .filter(function (p) { return p && p.text })
    .map(function (p) {
      return {
        text: p.text,
        speaker: (p.speaker !== undefined && p.speaker !== null)
          ? 'Speaker ' + (p.speaker + 1)
          : null
      }
    })
}

// ── Helper: build the common transcript-page vars from session ────────────────
function transcriptVarsFromSession (session) {
  var raw      = session.data.phrases || []
  var phrases  = formatPhrases(raw)
  return {
    transcript:  session.data.transcript,
    engine:      session.data.engine || 'mai',
    phrases:     phrases,
    hasSpeakers: phrases.some(function (p) { return p.speaker !== null })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page routes
// ─────────────────────────────────────────────────────────────────────────────

// GET / – Start page
router.get('/', function (req, res) {
  res.render('index')
})

// GET /choose – Method choice
router.get('/choose', function (req, res) {
  res.render('choose')
})

// POST /choose – Validate and redirect
router.post('/choose', function (req, res) {
  var choice = req.body && req.body.choice

  if (!choice) {
    return res.render('choose', {
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [
          {
            text: 'Select how you want to provide audio',
            href: '#choice'
          }
        ]
      },
      errors: {
        choice: {
          text: 'Select how you want to provide audio'
        }
      }
    })
  }

  if (choice === 'upload') return res.redirect('/upload')
  if (choice === 'record') return res.redirect('/record')

  // Unexpected value – treat as validation failure
  return res.redirect('/choose')
})

// GET /upload – WAV file upload form
router.get('/upload', function (req, res) {
  res.render('upload')
})

// POST /upload – Receive file, transcribe, redirect to /result
// multerFormMiddleware parses the multipart body and handles multer errors.
router.post('/upload', multerFormMiddleware, async function (req, res) {
  var engine = resolveEngine(req.body && req.body.engine)

  // Reject requests with a present-but-invalid engine value
  if (engine === null) {
    return res.render('upload', {
      engine: 'mai',
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [{ text: 'Select a transcription engine', href: '#engine' }]
      },
      errors: { engine: { text: 'Select a transcription engine' } }
    })
  }

  // Guard: multer populates req.file only when a file was sent
  if (!req.file || !req.file.size) {
    return res.render('upload', {
      engine,
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [
          {
            text: 'Select a WAV file to upload',
            href: '#audio'
          }
        ]
      },
      errors: {
        audio: {
          text: 'Select a WAV file to upload'
        }
      }
    })
  }

  try {
    const { transcript, engine: usedEngine, phrases } = await transcribeAudio({
      buffer:       req.file.buffer,
      mimetype:     req.file.mimetype || 'audio/wav',
      originalname: req.file.originalname,
      locale:       req.body && req.body.locale,
      engine
    })

    req.session.data.transcript       = transcript
    req.session.data.transcriptSource = 'upload'
    req.session.data.engine           = usedEngine
    req.session.data.phrases          = phrases
    req.session.data.summary          = null
    req.session.data.summaryModel     = null

    return res.redirect('/result')
  } catch (err) {
    console.error('[POST /upload] Transcription error:', err.message)
    return res.render('upload', {
      engine,
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [
          {
            text: err.message || 'The audio could not be transcribed. Please try a different file.'
          }
        ]
      }
    })
  }
})

// GET /record – MediaRecorder page
router.get('/record', function (req, res) {
  res.render('record')
})

// GET /result – Show transcript + model picker
router.get('/result', function (req, res) {
  if (!hasTranscript(req)) {
    return res.redirect('/choose')
  }

  var tvars = transcriptVarsFromSession(req.session)
  const models = getAvailableModels()

  if (models.length === 0) {
    // AVAILABLE_MODELS env var is not set – show a configuration error
    return res.render('result', Object.assign(tvars, {
      modelItems: [],
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [
          {
            text: 'No AI models are configured. Set the AVAILABLE_MODELS environment variable.'
          }
        ]
      }
    }))
  }

  res.render('result', Object.assign(tvars, {
    modelItems: buildModelItems(null)
  }))
})

// POST /result – Validate model selection, call Azure AI, redirect to /summary
router.post('/result', async function (req, res) {
  if (!hasTranscript(req)) {
    return res.redirect('/choose')
  }

  var tvars      = transcriptVarsFromSession(req.session)
  var transcript = tvars.transcript
  var model      = req.body && req.body.model
  var modelItems = buildModelItems(model)

  if (!model) {
    return res.render('result', Object.assign(tvars, {
      modelItems,
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [
          {
            text: 'Select a model to summarise the transcript',
            href: '#model'
          }
        ]
      },
      errors: {
        model: {
          text: 'Select a model to summarise the transcript'
        }
      }
    }))
  }

  try {
    const summary = await summariseTranscript({ transcript, model })

    req.session.data.summary      = summary
    req.session.data.summaryModel = model

    return res.redirect('/summary')
  } catch (err) {
    console.error('[POST /result] Summarise error:', err.message)
    return res.render('result', Object.assign(tvars, {
      modelItems,
      errorSummary: {
        titleText: 'There is a problem',
        errorList: [
          {
            text: err.message || 'The transcript could not be summarised. Please try again.'
          }
        ]
      }
    }))
  }
})

// GET /summary – Show transcript + summary
router.get('/summary', function (req, res) {
  if (!hasTranscript(req)) return res.redirect('/choose')

  const summary = req.session.data && req.session.data.summary
  if (!summary) return res.redirect('/result')

  res.render('summary', {
    transcript:   req.session.data.transcript,
    summary:      req.session.data.summary,
    summaryModel: req.session.data.summaryModel
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// API routes  (called by browser JS; not the standard form-POST flow)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/transcribe
 *
 * Accepts a multipart/form-data body with:
 *   audio  – the audio blob (required)
 *   engine – 'fast' | 'llm' | 'mai' (optional, defaults to 'mai')
 *   locale – BCP-47 locale hint (optional)
 *
 * Calls Azure Speech, stores the transcript in the session, and returns:
 *   { transcript, engine, redirect: "/result" }  on success
 *   { error: string }                             on failure (4xx/5xx)
 *
 * Used exclusively by the /record page's JavaScript.
 */
router.post('/api/transcribe', multerApiMiddleware, async function (req, res) {
  if (!req.file || !req.file.size) {
    return res.status(400).json({ error: 'No audio file was provided' })
  }

  var engine = resolveEngine(req.body && req.body.engine)

  // Reject requests with a present-but-invalid engine value
  if (engine === null) {
    return res.status(400).json({
      error: 'Invalid engine value. Must be one of: fast, llm, mai.',
      code: 'INVALID_ENGINE'
    })
  }

  try {
    const { transcript, engine: usedEngine, phrases } = await transcribeAudio({
      buffer:       req.file.buffer,
      mimetype:     req.file.mimetype || 'audio/webm',
      originalname: req.file.originalname || 'recording.webm',
      locale:       req.body && req.body.locale,
      engine
    })

    req.session.data.transcript       = transcript
    req.session.data.transcriptSource = 'record'
    req.session.data.engine           = usedEngine
    req.session.data.phrases          = phrases
    req.session.data.summary          = null
    req.session.data.summaryModel     = null

    // Persist session before responding so the redirect lands on valid data
    req.session.save(function (saveErr) {
      if (saveErr) {
        console.error('[POST /api/transcribe] Session save error:', saveErr)
      }
      res.json({ transcript, engine: usedEngine, redirect: '/result' })
    })
  } catch (err) {
    console.error('[POST /api/transcribe] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message || 'Transcription failed' })
  }
})
