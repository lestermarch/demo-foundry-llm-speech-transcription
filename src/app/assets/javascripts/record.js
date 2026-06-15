/**
 * record.js – MediaRecorder-based audio capture for the MAI-Transcribe Demo.
 *
 * Progressive enhancement:
 *  - #browser-fallback is visible by default in the HTML.
 *  - This script hides it only after confirming MediaRecorder is available,
 *    then reveals #recorder-app.
 *  - If MediaRecorder is unavailable (or JS is disabled entirely), the fallback
 *    panel remains visible and offers a link to /upload.
 *
 * Accessibility:
 *  - Start/Stop buttons use aria-disabled to communicate state to screen readers.
 *  - Timer uses aria-live="polite" so elapsed time is announced periodically.
 *  - Status updates use aria-live="polite".
 *  - Errors use aria-live="assertive".
 */

;(function () {
  'use strict'

  // ── Feature detection ───────────────────────────────────────────────────────
  // #browser-fallback is visible by default. Hide it only when MediaRecorder
  // is confirmed available; otherwise leave it visible for the user to act on.
  var browserFallback = document.getElementById('browser-fallback')

  if (
    typeof window === 'undefined' ||
    !window.MediaRecorder ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    // Browser does not support recording — the fallback panel stays visible.
    return
  }

  // MediaRecorder available: hide the fallback, show the recorder UI
  if (browserFallback) browserFallback.setAttribute('hidden', '')

  // ── Show JS-only interface ──────────────────────────────────────────────────
  var recorderApp = document.getElementById('recorder-app')
  if (!recorderApp) return
  recorderApp.removeAttribute('hidden')

  // ── Element references ──────────────────────────────────────────────────────
  var startBtn      = document.getElementById('start-btn')
  var stopBtn       = document.getElementById('stop-btn')
  var useBtn        = document.getElementById('use-btn')
  var rerecordBtn   = document.getElementById('rerecord-btn')
  var timerWrap     = document.getElementById('timer-wrap')
  var timerDisplay  = document.getElementById('timer-display')
  var reviewPanel   = document.getElementById('review-panel')
  var audioPreview  = document.getElementById('audio-preview')
  var statusMsg     = document.getElementById('status-message')
  var errorContainer = document.getElementById('error-container')

  // ── State ───────────────────────────────────────────────────────────────────
  var mediaRecorder   = null
  var recordedChunks  = []
  var recordedBlob    = null
  var timerInterval   = null
  var elapsedSeconds  = 0

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function formatTime (s) {
    var m = Math.floor(s / 60)
    var sec = s % 60
    return m + ':' + (sec < 10 ? '0' : '') + sec
  }

  function setButtonEnabled (btn, enabled) {
    btn.disabled = !enabled
    if (enabled) {
      btn.removeAttribute('aria-disabled')
    } else {
      btn.setAttribute('aria-disabled', 'true')
    }
  }

  function showStatus (message) {
    statusMsg.textContent = message
    statusMsg.removeAttribute('hidden')
  }

  function hideStatus () {
    statusMsg.setAttribute('hidden', '')
    statusMsg.textContent = ''
  }

  function showError (message) {
    // Inject a GOV.UK error summary into the error container
    errorContainer.innerHTML =
      '<div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1" role="alert">' +
        '<div role="alert">' +
          '<h2 class="govuk-error-summary__title">There is a problem</h2>' +
          '<div class="govuk-error-summary__body">' +
            '<ul class="govuk-list govuk-error-summary__list">' +
              '<li>' + escapeHtml(message) + '</li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
      '</div>'
    // Initialise the error summary module so it shifts focus
    if (window.GOVUKFrontend) {
      var el = errorContainer.querySelector('[data-module="govuk-error-summary"]')
      if (el) {
        new window.GOVUKFrontend.ErrorSummary(el).init()
      }
    }
  }

  function clearError () {
    errorContainer.innerHTML = ''
  }

  function escapeHtml (str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── Pick the best supported MIME type ──────────────────────────────────────
  function getBestMimeType () {
    var candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/wav',
      ''
    ]
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i] || MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i]
      }
    }
    return ''
  }

  // ── Start recording ─────────────────────────────────────────────────────────
  startBtn.addEventListener('click', function () {
    clearError()
    hideStatus()

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        recordedChunks = []

        var mimeType = getBestMimeType()
        var options  = mimeType ? { mimeType: mimeType } : {}

        mediaRecorder = new MediaRecorder(stream, options)

        mediaRecorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data)
          }
        }

        mediaRecorder.onstop = function () {
          // Stop all tracks to release the microphone indicator
          stream.getTracks().forEach(function (track) { track.stop() })

          clearInterval(timerInterval)
          timerWrap.setAttribute('hidden', '')

          var usedMime = mediaRecorder.mimeType || 'audio/webm'
          recordedBlob = new Blob(recordedChunks, { type: usedMime })
          audioPreview.src = URL.createObjectURL(recordedBlob)

          reviewPanel.removeAttribute('hidden')

          setButtonEnabled(startBtn, true)
          setButtonEnabled(stopBtn, false)
          // Re-enable review actions so the user can submit or re-record
          setButtonEnabled(useBtn, true)
          setButtonEnabled(rerecordBtn, true)
        }

        mediaRecorder.start(500) // timeslice: collect data every 500 ms

        // Update UI
        setButtonEnabled(startBtn, false)
        setButtonEnabled(stopBtn, true)
        setButtonEnabled(useBtn, false)
        reviewPanel.setAttribute('hidden', '')

        // Start timer
        elapsedSeconds = 0
        timerDisplay.textContent = formatTime(elapsedSeconds)
        timerWrap.removeAttribute('hidden')
        timerInterval = setInterval(function () {
          elapsedSeconds++
          timerDisplay.textContent = formatTime(elapsedSeconds)
        }, 1000)
      })
      .catch(function (err) {
        var msg = 'Could not access the microphone.'
        if (err && err.name === 'NotAllowedError') {
          msg = 'Microphone access was denied. Please allow microphone access in your browser settings and try again.'
        } else if (err && err.name === 'NotFoundError') {
          msg = 'No microphone was found. Please connect a microphone and try again.'
        } else if (err && err.message) {
          msg = 'Could not access the microphone: ' + err.message
        }
        showError(msg)
      })
  })

  // ── Stop recording ──────────────────────────────────────────────────────────
  stopBtn.addEventListener('click', function () {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }
  })

  // ── Re-record ───────────────────────────────────────────────────────────────
  rerecordBtn.addEventListener('click', function () {
    recordedBlob = null
    recordedChunks = []
    if (audioPreview.src) {
      URL.revokeObjectURL(audioPreview.src)
      audioPreview.src = ''
    }
    reviewPanel.setAttribute('hidden', '')
    clearError()
    hideStatus()
    setButtonEnabled(useBtn, true)
    setButtonEnabled(rerecordBtn, true)
  })

  // ── Submit recording for transcription ──────────────────────────────────────
  useBtn.addEventListener('click', function () {
    if (!recordedBlob) return

    clearError()
    setButtonEnabled(useBtn, false)
    setButtonEnabled(rerecordBtn, false)
    showStatus('Uploading and transcribing your recording. This may take a few moments…')

    // Determine file extension from MIME type
    var mimeType  = recordedBlob.type || 'audio/webm'
    var extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    var filename  = 'recording.' + extension

    // Read the engine radio and optional locale field that are rendered above
    // the recorder controls in the #recorder-app section.
    var engineEl  = document.querySelector('#recorder-app input[name="engine"]:checked')
    var localeEl  = document.getElementById('locale')
    var engine    = engineEl ? engineEl.value : 'mai'
    var locale    = localeEl ? localeEl.value.trim() : ''

    var formData = new FormData()
    formData.append('audio', recordedBlob, filename)
    formData.append('engine', engine)
    if (locale) formData.append('locale', locale)

    fetch('/api/transcribe', {
      method: 'POST',
      body: formData
    })
      .then(function (response) {
        // Parse JSON body regardless of HTTP status so we can read error messages
        return response.json().then(function (data) {
          return { ok: response.ok, status: response.status, data: data }
        })
      })
      .then(function (result) {
        if (result.ok && result.data && result.data.redirect) {
          window.location.href = result.data.redirect
        } else {
          var errorMsg = (result.data && result.data.error) || 'Transcription failed. Please try again.'
          throw new Error(errorMsg)
        }
      })
      .catch(function (err) {
        hideStatus()
        setButtonEnabled(useBtn, true)
        setButtonEnabled(rerecordBtn, true)
        showError('Transcription failed: ' + (err.message || 'Unknown error') + '. Please try again or re-record.')
      })
  })

})()
