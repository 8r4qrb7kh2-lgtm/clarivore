import { analyzeAllergensWithLabelCropper } from "./ingredient-allergen-analysis.js";

const allergenConfig = window.loadAllergenDietConfig
  ? await window.loadAllergenDietConfig()
  : (window.ALLERGEN_DIET_CONFIG || {});

(function (config) {
  'use strict';

  const allergenConfig = config || {};
  const DIETS = Array.isArray(allergenConfig.DIETS) ? allergenConfig.DIETS : [];
  const normalizeAllergen = typeof allergenConfig.normalizeAllergen === 'function'
    ? allergenConfig.normalizeAllergen
    : (value) => String(value || '').toLowerCase().trim();
  const normalizeDietLabel = typeof allergenConfig.normalizeDietLabel === 'function'
    ? allergenConfig.normalizeDietLabel
    : (value) => value;
  const getDietAllergenConflicts =
    typeof allergenConfig.getDietAllergenConflicts === 'function'
      ? allergenConfig.getDietAllergenConflicts
      : () => [];

  function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function getApiKey(keyName) {
    return localStorage.getItem(`clarivore_${keyName}`) || '';
  }

  function setApiKey(keyName, value) {
    localStorage.setItem(`clarivore_${keyName}`, value);
  }

  async function ensureApiKeysConfigured() {
    const anthropicKey = getApiKey('anthropic_api_key');
    const googleKey = getApiKey('google_vision_api_key');

    if (anthropicKey && googleKey) {
      return true;
    }

    return new Promise((resolve) => {
      const setupModal = document.createElement('div');
      setupModal.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'right: 0',
        'bottom: 0',
        'background: rgba(0,0,0,0.95)',
        'z-index: 10001',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'padding: 20px'
      ].join(';');

      setupModal.innerHTML = `
        <div style="width:100%;max-width:500px;background:#1a1f35;border-radius:16px;padding:24px">
          <h3 style="margin:0 0 16px 0;font-size:1.3rem;color:#fff">One-Time Setup</h3>
          <p style="color:#a8b2d6;margin-bottom:20px;font-size:0.95rem">Enter your API keys to enable ingredient photo analysis. This only needs to be done once.</p>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div>
              <label style="display:block;font-size:0.9rem;color:#a8b2d6;margin-bottom:6px">Anthropic API Key</label>
              <input type="password" id="setupAnthropicKey" value="${esc(anthropicKey)}" placeholder="sk-ant-..." style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(76,90,212,0.4);border-radius:8px;color:#fff;font-size:1rem">
            </div>
            <div>
              <label style="display:block;font-size:0.9rem;color:#a8b2d6;margin-bottom:6px">Google Cloud Vision API Key</label>
              <input type="password" id="setupGoogleKey" value="${esc(googleKey)}" placeholder="AIza..." style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(76,90,212,0.4);border-radius:8px;color:#fff;font-size:1rem">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px">
              <button type="button" id="setupSaveBtn" style="flex:1;padding:14px;background:#17663a;border:none;border-radius:8px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer">Save & Continue</button>
              <button type="button" id="setupCancelBtn" style="padding:14px 24px;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);border-radius:8px;color:#ef4444;font-size:1rem;cursor:pointer">Cancel</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(setupModal);

      setupModal.querySelector('#setupSaveBtn').onclick = () => {
        const aKey = setupModal.querySelector('#setupAnthropicKey').value.trim();
        const gKey = setupModal.querySelector('#setupGoogleKey').value.trim();
        if (aKey && gKey) {
          setApiKey('anthropic_api_key', aKey);
          setApiKey('google_vision_api_key', gKey);
          setupModal.remove();
          resolve(true);
        } else {
          alert('Please enter both API keys.');
        }
      };

      setupModal.querySelector('#setupCancelBtn').onclick = () => {
        setupModal.remove();
        resolve(false);
      };
    });
  }

  async function callClaudeForAnalysis(messages, systemPrompt = '', options = {}) {
    const apiKey = getApiKey('anthropic_api_key');
    if (!apiKey) {
      throw new Error('Anthropic API key not configured.');
    }

    const { useExtendedThinking = false, model = 'claude-sonnet-4-5-20250929' } = options;

    const requestBody = {
      model: model,
      max_tokens: useExtendedThinking ? 16000 : 4096,
      messages: messages
    };

    if (!useExtendedThinking && systemPrompt) {
      requestBody.system = systemPrompt;
    }

    if (useExtendedThinking) {
      requestBody.thinking = {
        type: 'enabled',
        budget_tokens: 10000
      };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Claude API request failed');
    }

    const data = await response.json();

    if (useExtendedThinking) {
      for (const block of data.content) {
        if (block.type === 'text') {
          return block.text;
        }
      }
      return '';
    }

    return data.content[0].text;
  }

  async function getClaudeTranscription(imageBase64, mediaType) {
    const systemPrompt = `You are an OCR assistant. Your job is to accurately transcribe text from images of ingredient lists or food labels.

Output ONLY a JSON array where each element represents one visual line of text as it appears in the image.
Each line should be the exact text content, preserving the original line breaks as they appear visually.

Example output format:
["INGREDIENTS: Almonds, Dark Chocolate", "(chocolate liquor, cane sugar, cocoa butter,", "vanilla). Organic Coconut.", "CONTAINS: Tree nuts"]

Rules:
- Each array element = one visual line from the image
- Preserve exact spelling and punctuation
- Include ONLY text related to: ingredients, allergen information, allergy warnings, dietary claims
- EXCLUDE: company names, addresses, phone numbers, websites, UPC codes, weight/volume, nutrition facts, logos, brand names, origin info, or anything else like that
- Do not combine multiple visual lines into one
- Do not split one visual line into multiple entries
- Output ONLY the JSON array, no other text`;

    const response = await callClaudeForAnalysis([{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType || 'image/png',
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: 'Transcribe each line of text from this ingredient label. Return as a JSON array with one element per visual line.'
        }
      ]
    }], systemPrompt);

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Could not parse Claude transcription response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  async function getVisionWords(imageBase64) {
    const googleApiKey = getApiKey('google_vision_api_key');
    if (!googleApiKey) {
      throw new Error('Google Cloud Vision API key not configured.');
    }

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          image: { content: imageBase64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Google Cloud Vision API request failed');
    }

    const data = await response.json();
    const annotation = data.responses[0]?.fullTextAnnotation;

    if (!annotation) {
      throw new Error('No text detected by Google Cloud Vision');
    }

    const words = [];

    annotation.pages?.forEach(page => {
      page.blocks?.forEach(block => {
        block.paragraphs?.forEach(paragraph => {
          paragraph.words?.forEach(word => {
            const text = word.symbols?.map(s => s.text).join('') || '';
            if (text.trim()) {
              const vertices = word.boundingBox?.vertices || [];
              if (vertices.length === 4) {
                const x0 = Math.min(...vertices.map(v => v.x || 0));
                const y0 = Math.min(...vertices.map(v => v.y || 0));
                const x1 = Math.max(...vertices.map(v => v.x || 0));
                const y1 = Math.max(...vertices.map(v => v.y || 0));

                words.push({
                  text: text.trim(),
                  bbox: { x0, y0, x1, y1 },
                  centerY: (y0 + y1) / 2,
                  centerX: (x0 + x1) / 2
                });
              }
            }
          });
        });
      });
    });

    return words;
  }

  async function matchLinesToVisualLines(claudeLines, visualLines) {
    const systemPrompt = `You are a text matching assistant. You will receive:
1. Transcript lines - accurate text from Claude's reading of the image
2. Visual lines - OCR-detected text grouped by position (may have errors/typos)

Your job is to match each transcript line to the visual line that represents the same text.

Output a JSON object where:
- Keys are transcript line indices (0, 1, 2, etc.)
- Values are the corresponding visual line index

Rules:
- Match based on text similarity (the visual line text may have OCR errors)
- Each transcript line should match to exactly ONE visual line
- If a transcript line has no good match, use -1
- Visual lines may be unused (they might be addresses, nutrition info, etc.)

Example output:
{"0": 5, "1": 6, "2": 7, "3": 8, "4": -1}

Output ONLY the JSON object, nothing else.`;

    const transcriptDesc = claudeLines.map((line, i) => `Transcript ${i}: "${line}"`).join('\n');
    const visualDesc = visualLines.map((vl, i) => `Visual ${i}: "${vl.text}"`).join('\n');

    const response = await callClaudeForAnalysis([{
      role: 'user',
      content: `Match each transcript line to its corresponding visual line.\n\nTRANSCRIPT LINES:\n${transcriptDesc}\n\nVISUAL LINES:\n${visualDesc}\n\nReturn a JSON object mapping transcript indices to visual line indices.`
    }], systemPrompt);

    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse line matching response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  function findMissingWordsAndBuildLines(claudeLines, visualLines, lineMapping, visionWords) {
    function wordMatchesTranscript(wordText, transcriptText) {
      const cleanWord = wordText.toLowerCase().replace(/[.,;:!?()[\]{}'"]/g, '');
      if (cleanWord.length === 0) return false;

      const transcriptWords = transcriptText.toLowerCase().split(/[\s,.:;()\[\]]+/).filter(w => w.length > 0);

      return transcriptWords.some(tw =>
        tw === cleanWord ||
        (cleanWord.length > 2 && tw.includes(cleanWord) && cleanWord.length >= tw.length * 0.7) ||
        (tw.length > 2 && cleanWord.includes(tw) && tw.length >= cleanWord.length * 0.7)
      );
    }

    const lines = [];

    for (let i = 0; i < claudeLines.length; i++) {
      const visualIdx = lineMapping[i.toString()];
      if (visualIdx === undefined || visualIdx === -1 || visualIdx >= visualLines.length) continue;

      const vl = visualLines[visualIdx];
      const transcriptText = claudeLines[i];

      let matchingWords = vl.words.filter(w => wordMatchesTranscript(w.text, transcriptText));

      const transcriptWords = transcriptText.toLowerCase().split(/[\s,.:;()\[\]]+/).filter(w => w.length > 1);

      const transcriptWordCounts = {};
      transcriptWords.forEach(tw => {
        transcriptWordCounts[tw] = (transcriptWordCounts[tw] || 0) + 1;
      });

      const matchedWordCounts = {};
      matchingWords.forEach(w => {
        const clean = w.text.toLowerCase().replace(/[.,;:!?()[\]{}'"]/g, '');
        matchedWordCounts[clean] = (matchedWordCounts[clean] || 0) + 1;
      });

      const missingWords = [];
      for (const [word, neededCount] of Object.entries(transcriptWordCounts)) {
        const matchedCount = matchedWordCounts[word] || 0;
        const missing = neededCount - matchedCount;
        for (let i = 0; i < missing; i++) {
          missingWords.push(word);
        }
      }

      const usedBboxes = new Set(matchingWords.map(w => `${w.bbox.x0},${w.bbox.y0}`));

      const vlYMin = Math.min(...vl.words.map(w => w.bbox.y0));
      const vlYMax = Math.max(...vl.words.map(w => w.bbox.y1));
      const vlHeight = vlYMax - vlYMin;
      const yTolerance = vlHeight * 0.5;

      for (const missingWord of missingWords) {
        const matches = visionWords.filter(w => {
          const wTextClean = w.text.toLowerCase().replace(/[.,;:!?()[\]{}'"]/g, '');
          const bboxKey = `${w.bbox.x0},${w.bbox.y0}`;
          const isExactMatch = wTextClean === missingWord;
          const isCloseMatch = (wTextClean.length > 2 && missingWord.length > 2) && (
            (wTextClean.includes(missingWord) && missingWord.length >= wTextClean.length * 0.7) ||
            (missingWord.includes(wTextClean) && wTextClean.length >= missingWord.length * 0.7)
          );
          const notUsed = !usedBboxes.has(bboxKey);
          const withinYRange = w.centerY >= (vlYMin - yTolerance) && w.centerY <= (vlYMax + yTolerance);
          return (isExactMatch || isCloseMatch) && notUsed && withinYRange;
        });

        if (matches.length > 0) {
          const avgY = matchingWords.length > 0
            ? matchingWords.reduce((sum, w) => sum + w.centerY, 0) / matchingWords.length
            : (vlYMin + vlYMax) / 2;

          matches.sort((a, b) => Math.abs(a.centerY - avgY) - Math.abs(b.centerY - avgY));
          const bestMatch = matches[0];

          if (Math.abs(bestMatch.centerY - avgY) < vlHeight * 1.5) {
            matchingWords.push(bestMatch);
            usedBboxes.add(`${bestMatch.bbox.x0},${bestMatch.bbox.y0}`);
          }
        }
      }

      const wordsForBbox = matchingWords.length > 0 ? matchingWords : vl.words;

      const x0 = Math.min(...wordsForBbox.map(w => w.bbox.x0));
      const y0 = Math.min(...wordsForBbox.map(w => w.bbox.y0));
      const x1 = Math.max(...wordsForBbox.map(w => w.bbox.x1));
      const y1 = Math.max(...wordsForBbox.map(w => w.bbox.y1));

      lines.push({
        text: claudeLines[i],
        bbox: { x0, y0, x1, y1 },
        words: matchingWords
      });
    }

    return lines;
  }

  async function analyzeWithLabelCropper(imageDataUrl, onStatus) {
    const base64Data = imageDataUrl.split(',')[1];
    const mediaType = imageDataUrl.split(';')[0].split(':')[1] || 'image/jpeg';

    onStatus?.('Reading text from image...');

    const claudeLines = await getClaudeTranscription(base64Data, mediaType);

    onStatus?.('Detecting word positions...');

    const visionWords = await getVisionWords(base64Data);

    const sortedWords = [...visionWords].sort((a, b) => a.centerY - b.centerY || a.bbox.x0 - b.bbox.x0);

    const yGroups = [];
    let currentYGroup = [];
    let groupStartY = -100;

    sortedWords.forEach(w => {
      if (currentYGroup.length === 0 || Math.abs(w.centerY - groupStartY) > 15) {
        if (currentYGroup.length > 0) yGroups.push(currentYGroup);
        currentYGroup = [w];
        groupStartY = w.centerY;
      } else {
        currentYGroup.push(w);
      }
    });
    if (currentYGroup.length > 0) yGroups.push(currentYGroup);

    const visualLines = [];

    yGroups.forEach(yGroup => {
      yGroup.sort((a, b) => a.bbox.x0 - b.bbox.x0);

      const wordWidths = yGroup.map(w => w.bbox.x1 - w.bbox.x0).sort((a, b) => a - b);
      const medianWidth = wordWidths[Math.floor(wordWidths.length / 2)] || 50;
      const gapThreshold = medianWidth * 3;

      let currentLine = [];
      let lastX1 = -Infinity;

      yGroup.forEach(w => {
        const gap = w.bbox.x0 - lastX1;

        if (currentLine.length > 0 && gap > gapThreshold) {
          const text = currentLine.map(w => w.text).join(' ');
          const x0 = Math.min(...currentLine.map(w => w.bbox.x0));
          const y0 = Math.min(...currentLine.map(w => w.bbox.y0));
          const x1 = Math.max(...currentLine.map(w => w.bbox.x1));
          const y1 = Math.max(...currentLine.map(w => w.bbox.y1));
          visualLines.push({ text, bbox: { x0, y0, x1, y1 }, words: currentLine });
          currentLine = [];
        }

        currentLine.push(w);
        lastX1 = w.bbox.x1;
      });

      if (currentLine.length > 0) {
        const text = currentLine.map(w => w.text).join(' ');
        const x0 = Math.min(...currentLine.map(w => w.bbox.x0));
        const y0 = Math.min(...currentLine.map(w => w.bbox.y0));
        const x1 = Math.max(...currentLine.map(w => w.bbox.x1));
        const y1 = Math.max(...currentLine.map(w => w.bbox.y1));
        visualLines.push({ text, bbox: { x0, y0, x1, y1 }, words: currentLine });
      }
    });

    onStatus?.('Matching text to visual lines...');

    const lineMapping = await matchLinesToVisualLines(claudeLines, visualLines);

    onStatus?.('Building word layout...');

    const lines = findMissingWordsAndBuildLines(claudeLines, visualLines, lineMapping, visionWords);

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageDataUrl;
    });
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    const data = lines.map((line, idx) => ({
      line_number: idx + 1,
      text: line.text,
      words: line.words.map(w => ({
        text: w.text,
        x_start: (w.bbox.x0 / imgWidth) * 100,
        x_end: (w.bbox.x1 / imgWidth) * 100,
        y_start: (w.bbox.y0 / imgHeight) * 100,
        y_end: (w.bbox.y1 / imgHeight) * 100
      })),
      crop_coordinates: {
        x_start: (line.bbox.x0 / imgWidth) * 100,
        y_start: (line.bbox.y0 / imgHeight) * 100,
        x_end: (line.bbox.x1 / imgWidth) * 100,
        y_end: (line.bbox.y1 / imgHeight) * 100
      }
    }));

    return {
      success: true,
      data: data,
      claude_transcript: claudeLines
    };
  }

  async function analyzeIngredientPhoto(imageDataUrl, onStatus, options = {}) {
    const skipAllergenAnalysis = options && options.skipAllergenAnalysis === true;
    const keysConfigured = await ensureApiKeysConfigured();
    if (!keysConfigured) {
      throw new Error('API keys are required for photo analysis.');
    }

    onStatus?.('Checking image orientation...');

    let correctedImage = imageDataUrl;
    const slantAngle = await detectSlantAngle(imageDataUrl);
    if (Math.abs(slantAngle) > 1) {
      onStatus?.('Straightening image...');
      correctedImage = await rotateImage(imageDataUrl, slantAngle);
    }

    const analysisResult = await analyzeWithLabelCropper(correctedImage, onStatus);

    if (!analysisResult.success || !analysisResult.data) {
      throw new Error('Failed to extract ingredient lines');
    }

    const lines = analysisResult.data;
    const transcript = lines.map(l => l.text);

    onStatus?.('Analyzing ingredients');

    let allergenFlags = [];
    if (!skipAllergenAnalysis) {
      const allergenResult = await analyzeAllergensWithLabelCropper(transcript);
      allergenFlags = allergenResult.success && allergenResult.data?.flags
        ? allergenResult.data.flags
        : [];
    }

    return {
      lines: lines,
      allergenFlags: allergenFlags,
      correctedImage: correctedImage,
      transcript: transcript,
      allergenAnalysisPending: skipAllergenAnalysis
    };
  }

  function rotateImage(imgSrc, angleDegrees) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const angleRad = angleDegrees * Math.PI / 180;

        const sin = Math.abs(Math.sin(angleRad));
        const cos = Math.abs(Math.cos(angleRad));
        const newWidth = Math.ceil(img.width * cos + img.height * sin);
        const newHeight = Math.ceil(img.width * sin + img.height * cos);

        canvas.width = newWidth;
        canvas.height = newHeight;

        ctx.translate(newWidth / 2, newHeight / 2);
        ctx.rotate(angleRad);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = reject;
      img.src = imgSrc;
    });
  }

  async function waitForOpenCvReady(timeoutMs = 2000) {
    if (typeof cv === 'undefined') return false;
    if (cv.Mat) return true;
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(!!cv.Mat);
        }
      }, timeoutMs);
      cv.onRuntimeInitialized = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(true);
      };
    });
  }

  async function detectSlantAngle(imageDataUrl) {
    const ready = await waitForOpenCvReady();
    if (!ready) {
      return 0;
    }

    return new Promise((resolve) => {

      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 800;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          const src = cv.imread(canvas);
          const gray = new cv.Mat();

          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

          const cx = Math.floor(w / 2);
          const cy = Math.floor(h / 2);
          const roiW = Math.floor(w * 0.6);
          const roiH = Math.floor(h * 0.6);
          const roiX = cx - Math.floor(roiW / 2);
          const roiY = cy - Math.floor(roiH / 2);

          const roi = gray.roi(new cv.Rect(roiX, roiY, roiW, roiH));

          const thresh = new cv.Mat();
          cv.adaptiveThreshold(roi, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY_INV, 51, 10);

          const lines = new cv.Mat();
          cv.HoughLinesP(thresh, lines, 1, Math.PI / 180, 50, 50, 10);

          const angles = [];

          for (let i = 0; i < lines.rows; i++) {
            const x1 = lines.data32S[i * 4];
            const y1 = lines.data32S[i * 4 + 1];
            const x2 = lines.data32S[i * 4 + 2];
            const y2 = lines.data32S[i * 4 + 3];

            let angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);

            if (angle > 90) angle -= 180;
            if (angle < -90) angle += 180;

            if (Math.abs(angle) < 30) {
              angles.push(angle);
            }
          }

          src.delete();
          gray.delete();
          roi.delete();
          thresh.delete();
          lines.delete();

          if (angles.length === 0) {
            resolve(0);
            return;
          }

          angles.sort((a, b) => a - b);
          const medianAngle = angles[Math.floor(angles.length / 2)];

          resolve(-medianAngle);
        } catch (err) {
          resolve(0);
        }
      };
      img.onerror = () => resolve(0);
      img.src = imageDataUrl;
    });
  }

  function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    });
  }

  function showIngredientPhotoUploadModal(rowIdxOrIngredientName, ingredientNameOrOptions, barcode = null, preloadedData = null, options = {}) {
    let rowIdx = null;
    let ingredientName = '';
    let resolvedOptions = {};
    let resolvedPreloaded = preloadedData;

    if (typeof rowIdxOrIngredientName === 'number') {
      rowIdx = rowIdxOrIngredientName;
      ingredientName = ingredientNameOrOptions || '';
      resolvedOptions = options || {};
    } else {
      ingredientName = rowIdxOrIngredientName || '';
      resolvedOptions = ingredientNameOrOptions || {};
      resolvedPreloaded = preloadedData;
    }

    const inlineResults = resolvedOptions && resolvedOptions.inlineResults === true;
    const hasRowUpdates = typeof collectAiTableData === 'function' && typeof renderAiTable === 'function';
    const skipRowUpdates = resolvedOptions && resolvedOptions.skipRowUpdates === true
      ? true
      : (!hasRowUpdates || typeof rowIdx !== 'number' || rowIdx < 0);

    const onApplyResults = typeof resolvedOptions.onApplyResults === 'function'
      ? resolvedOptions.onApplyResults
      : null;

    let capturedPhoto = null;
    let analysisResult = null;
    let mediaStream = null;
    let lineConfirmations = {};
    let lineCardMap = {};
    let lineConfirmButtons = {};
    let wordSpanMap = {};
    let lineWordDataMap = {};
    let lineTextContainers = {};
    let activeWordEditor = null;
    let nextGlobalWordIndex = 0;
    let lineLayoutHandlers = [];
    let resizeHandler = null;
    let reanalysisRequestId = 0;
    let analysisOverlay = null;
    let analysisOverlayMessage = null;
    let analysisPending = false;

    const photoModal = document.createElement('div');
    photoModal.id = 'ingredientPhotoModal';
    photoModal.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'background: rgba(0,0,0,0.95)',
      'z-index: 10000',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'padding: 20px',
      'padding-top: max(20px, env(safe-area-inset-top))',
      'padding-bottom: max(20px, env(safe-area-inset-bottom))',
      'overflow-y: auto',
      '-webkit-overflow-scrolling: touch'
    ].join(';');

    photoModal.innerHTML = `
      <div style="width:100%;max-width:700px;display:flex;flex-direction:column;gap:16px">
        <div style="text-align:center">
          <h3 style="margin:0 0 8px 0;font-size:1.4rem;color:#fff">Capture Ingredient List</h3>
          <div style="margin:0;color:#a8b2d6;font-size:0.95rem">
            Ingredient: <strong style="color:#fff">${esc(ingredientName)}</strong>
          </div>
          <p id="photoInstructionText" style="margin:8px 0 0 0;color:#a8b2d6;font-size:0.9rem">
            Take a photo of the ingredient list on the product packaging
          </p>
        </div>

        <div style="position:relative;background:#000;border-radius:12px;overflow:hidden">
          <video id="ingredientCameraVideo" autoplay playsinline muted style="width:100%;max-height:50vh;display:none;object-fit:cover"></video>
          <canvas id="ingredientCameraCanvas" style="display:none"></canvas>
          <img id="ingredientPhotoPreview" style="width:100%;max-height:50vh;object-fit:contain;display:none" alt="Preview">
        </div>

        <div id="photoButtonsContainer" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button type="button" class="btn ingredientCameraBtn" style="background:#4c5ad4;padding:10px 20px">📷 Use Camera</button>
          <button type="button" class="btn ingredientUploadBtn" style="background:#4c5ad4;padding:10px 20px">📁 Upload Photo</button>
          <button type="button" class="btn ingredientCaptureBtn" style="background:#17663a;padding:10px 20px;display:none">📸 Capture</button>
          <button type="button" class="btn ingredientAnalyzeBtn" style="background:#17663a;padding:10px 20px;display:none">🔍 Analyze</button>
          <button type="button" class="btn ingredientCancelBtn" style="background:#ef4444;padding:10px 20px">Cancel</button>
          <input type="file" id="ingredientFileInput" accept="image/*" style="display:none">
        </div>

        <div id="photoStatusDiv" style="text-align:center;color:#a8b2d6;font-size:0.9rem;min-height:24px"></div>

        <div id="fullImageSection" style="display:none">
          <div style="background:rgba(76,90,212,0.1);border:1px solid rgba(76,90,212,0.3);border-radius:12px;padding:16px">
            <div style="font-weight:600;color:#fff;margin-bottom:12px">Detected Lines</div>
            <div id="fullImageContainer" style="position:relative;display:inline-block;width:100%"></div>
          </div>
        </div>

        <div id="croppedLinesSection" style="display:none">
          <div style="background:rgba(76,90,212,0.1);border:1px solid rgba(76,90,212,0.3);border-radius:12px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div style="font-weight:600;color:#fff">Extracted Ingredient Lines</div>
              <div id="confirmationStatus" style="font-size:0.85rem;color:#a8b2d6"></div>
            </div>
            <div style="margin-bottom:10px;color:#94a3b8;font-size:0.85rem">Tap a word to edit it. Tap between words to add missing text.</div>
            <div id="croppedLinesContainer" style="display:flex;flex-direction:column;gap:16px"></div>
          </div>
        </div>

        <div id="allergenResultsSection" style="display:none">
          <div style="background:rgba(76,90,212,0.1);border:1px solid rgba(76,90,212,0.3);border-radius:12px;padding:16px">
            <div style="font-weight:600;color:#fff;margin-bottom:12px">Allergen and Diet Analysis</div>
            <div id="allergenResultsContainer"></div>
          </div>
        </div>

        <div id="applyButtonContainer" style="display:none;justify-content:center;gap:12px;flex-wrap:wrap">
          <button type="button" class="btn applyResultsBtn" style="background:#17663a;padding:12px 24px;font-size:1rem">📷 Capture image of item front</button>
          <button type="button" class="btn retakePhotoBtn" style="background:#6b7280;padding:12px 24px">↩ Retake Photo</button>
          <button type="button" class="btn reportPhotoIssueBtn" style="background:#dc2626;padding:12px 24px">⚠️ Something's not right</button>
        </div>
      </div>
    `;

    document.body.appendChild(photoModal);

    const video = photoModal.querySelector('#ingredientCameraVideo');
    const canvas = photoModal.querySelector('#ingredientCameraCanvas');
    const preview = photoModal.querySelector('#ingredientPhotoPreview');
    const statusDiv = photoModal.querySelector('#photoStatusDiv');
    const buttonsContainer = photoModal.querySelector('#photoButtonsContainer');
    const cameraBtn = photoModal.querySelector('.ingredientCameraBtn');
    const uploadBtn = photoModal.querySelector('.ingredientUploadBtn');
    const captureBtn = photoModal.querySelector('.ingredientCaptureBtn');
    const analyzeBtn = photoModal.querySelector('.ingredientAnalyzeBtn');
    const cancelBtn = photoModal.querySelector('.ingredientCancelBtn');
    const fileInput = photoModal.querySelector('#ingredientFileInput');
    const fullImageSection = photoModal.querySelector('#fullImageSection');
    const fullImageContainer = photoModal.querySelector('#fullImageContainer');
    const croppedLinesSection = photoModal.querySelector('#croppedLinesSection');
    const croppedLinesContainer = photoModal.querySelector('#croppedLinesContainer');
    const confirmationStatus = photoModal.querySelector('#confirmationStatus');
    const allergenResultsSection = photoModal.querySelector('#allergenResultsSection');
    const allergenResultsContainer = photoModal.querySelector('#allergenResultsContainer');
    const applyButtonContainer = photoModal.querySelector('#applyButtonContainer');
    const applyBtn = photoModal.querySelector('.applyResultsBtn');
    const retakeBtn = photoModal.querySelector('.retakePhotoBtn');
    const reportPhotoIssueBtn = photoModal.querySelector('.reportPhotoIssueBtn');

    const stopCamera = () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }
      video.srcObject = null;
    };

    const closeModal = () => {
      stopCamera();
      cancelPendingReanalysis();
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      if (photoModal.parentNode) photoModal.remove();
    };

    const showButtons = (...btns) => {
      [cameraBtn, uploadBtn, captureBtn, analyzeBtn].forEach(b => b.style.display = 'none');
      btns.forEach(b => b.style.display = 'inline-block');
    };

    if (resolvedPreloaded && resolvedPreloaded.analysisResult) {
      analysisResult = resolvedPreloaded.analysisResult;
      capturedPhoto = resolvedPreloaded.originalPhoto || null;
      const correctedPreview = analysisResult.correctedImage || capturedPhoto;
      const pendingAnalysis = analysisResult.allergenAnalysisPending === true
        || (!analysisResult.allergenFlags?.length && analysisResult.allergenAnalysisPending !== false);

      if (correctedPreview) {
        preview.src = correctedPreview;
        preview.style.display = 'block';
      }

      displayCroppedLines(analysisResult.lines, correctedPreview || capturedPhoto, analysisResult.allergenFlags);
      if (!pendingAnalysis) {
        displayAllergenResults(analysisResult.allergenFlags);
        statusDiv.textContent = 'Allergen and diet analysis complete!';
        statusDiv.style.color = '#4ade80';
      } else {
        statusDiv.textContent = 'Text extracted. Running allergen and diet analysis...';
        statusDiv.style.color = '#a8b2d6';
      }
      buttonsContainer.style.display = 'none';
      applyButtonContainer.style.display = 'flex';
    }

    cameraBtn.addEventListener('click', async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        video.srcObject = mediaStream;
        video.style.display = 'block';
        preview.style.display = 'none';
        showButtons(captureBtn);
      } catch (err) {
        statusDiv.textContent = 'Camera access denied: ' + err.message;
        statusDiv.style.color = '#ef4444';
      }
    });

    captureBtn.addEventListener('click', () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      capturedPhoto = canvas.toDataURL('image/jpeg', 0.92);
      stopCamera();
      video.style.display = 'none';
      preview.src = capturedPhoto;
      preview.style.display = 'block';
      showButtons(analyzeBtn);
      statusDiv.textContent = 'Photo captured. Click Analyze to process.';
      statusDiv.style.color = '#a8b2d6';
    });

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const tempImg = new Image();
        tempImg.onload = () => {
          const c = document.createElement('canvas');
          c.width = tempImg.naturalWidth;
          c.height = tempImg.naturalHeight;
          c.getContext('2d').drawImage(tempImg, 0, 0);
          capturedPhoto = c.toDataURL('image/jpeg', 0.92);
          preview.src = capturedPhoto;
          preview.style.display = 'block';
          video.style.display = 'none';
          showButtons(analyzeBtn);
          statusDiv.textContent = 'Photo loaded. Click Analyze to process.';
        };
        tempImg.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });

    async function runInlineIngredientAnalysis(photoToAnalyze) {
      statusDiv.textContent = 'Analyzing...';
      statusDiv.style.color = '#a8b2d6';
      try {
        const result = await analyzeIngredientPhoto(photoToAnalyze, (status) => {
          statusDiv.textContent = status;
        }, { skipAllergenAnalysis: true });
        analysisResult = result;
        const correctedPreview = result.correctedImage || photoToAnalyze;
        if (correctedPreview) {
          preview.src = correctedPreview;
          preview.style.display = 'block';
        }
        displayCroppedLines(result.lines, correctedPreview || photoToAnalyze, result.allergenFlags);
        const pendingAnalysis = result.allergenAnalysisPending === true
          || (!result.allergenFlags?.length && result.allergenAnalysisPending !== false);
        if (!pendingAnalysis) {
          displayAllergenResults(result.allergenFlags);
          statusDiv.textContent = 'Allergen and diet analysis complete!';
          statusDiv.style.color = '#4ade80';
          hideAnalysisOverlay();
        } else {
          statusDiv.textContent = 'Text extracted. Running allergen and diet analysis...';
          statusDiv.style.color = '#a8b2d6';
        }
        buttonsContainer.style.display = 'none';
        applyButtonContainer.style.display = 'flex';
      } catch (err) {
        statusDiv.textContent = 'Analysis failed: ' + err.message;
        statusDiv.style.color = '#ef4444';
        hideAnalysisOverlay();
      }
    }

    analyzeBtn.addEventListener('click', async () => {
      if (!capturedPhoto) return;

      const canRunBackground = !skipRowUpdates &&
        typeof showPhotoAnalysisLoadingInRow === 'function' &&
        typeof updatePhotoAnalysisLoadingStatus === 'function' &&
        typeof showPhotoAnalysisResultButton === 'function';
      const useInlineResults = inlineResults || skipRowUpdates || !canRunBackground;

      if (useInlineResults) {
        await runInlineIngredientAnalysis(capturedPhoto);
        return;
      }

      closeModal();
      showPhotoAnalysisLoadingInRow(rowIdx, ingredientName);

      try {
        const result = await analyzeIngredientPhoto(capturedPhoto, (status) => {
          updatePhotoAnalysisLoadingStatus(rowIdx, status);
        }, { skipAllergenAnalysis: true });
        showPhotoAnalysisResultButton(rowIdx, ingredientName, result, capturedPhoto);
      } catch (err) {
        hidePhotoAnalysisLoadingInRow?.(rowIdx);
      }
    });

    function updateConfirmationUI(totalLines) {
      const confirmedCount = Object.values(lineConfirmations).filter(v => v).length;
      const allConfirmed = confirmedCount === totalLines;
      const readyToApply = allConfirmed && !analysisPending;

      confirmationStatus.textContent = `${confirmedCount}/${totalLines} lines confirmed`;
      confirmationStatus.style.color = allConfirmed ? '#22c55e' : '#f59e0b';

      if (readyToApply) {
        applyBtn.disabled = false;
        applyBtn.style.opacity = '1';
        applyBtn.style.cursor = 'pointer';
      } else {
        applyBtn.disabled = true;
        applyBtn.style.opacity = '0.5';
        applyBtn.style.cursor = 'not-allowed';
      }
    }

    function setLineConfirmationState(lineIdx, isConfirmed, totalLinesOverride = null) {
      lineConfirmations[lineIdx] = !!isConfirmed;
      const confirmBtn = lineConfirmButtons[lineIdx];
      const lineDiv = lineCardMap[lineIdx];
      if (confirmBtn) {
        if (isConfirmed) {
          confirmBtn.style.background = '#17663a';
          confirmBtn.style.borderColor = '#22c55e';
          confirmBtn.style.color = '#fff';
          confirmBtn.textContent = '✓ Confirmed';
        } else {
          confirmBtn.style.background = '#f59e0b';
          confirmBtn.style.borderColor = '#d97706';
          confirmBtn.style.color = '#fff';
          confirmBtn.textContent = 'Confirm';
        }
      }
      if (lineDiv) {
        lineDiv.style.border = isConfirmed ? '2px solid #22c55e' : 'none';
      }
      const totalLines = totalLinesOverride
        ?? (analysisResult?.lines?.length || Object.keys(lineConfirmations).length);
      updateConfirmationUI(totalLines);
    }

    function refreshTranscriptFromWords() {
      if (!analysisResult || !Array.isArray(analysisResult.lines)) return [];
      const transcript = analysisResult.lines.map((line, idx) => {
        const words = lineWordDataMap[idx];
        if (Array.isArray(words) && words.length) {
          const updated = buildLineText(idx);
          line.text = updated;
          return updated;
        }
        return line.text || '';
      });
      analysisResult.transcript = transcript;
      return transcript;
    }

    function reindexWordData() {
      let globalIndex = 0;
      const lineIndices = Object.keys(lineWordDataMap)
        .map(key => Number(key))
        .filter(key => !Number.isNaN(key))
        .sort((a, b) => a - b);
      lineIndices.forEach((lineIdx) => {
        const wordData = lineWordDataMap[lineIdx] || [];
        const sorted = wordData
          .map((word, idx) => ({ word, idx }))
          .sort((a, b) => (a.word.centerPct - b.word.centerPct) || (a.idx - b.idx));
        sorted.forEach((entry) => {
          entry.word.globalIndex = globalIndex++;
        });
      });
      nextGlobalWordIndex = globalIndex;
    }

    function ensureAnalysisOverlay() {
      if (analysisOverlay) return;
      const styleTag = document.createElement('style');
      styleTag.textContent = '@keyframes labelAnalysisSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
      photoModal.appendChild(styleTag);

      analysisOverlay = document.createElement('div');
      analysisOverlay.style.cssText = [
        'position: fixed',
        'inset: 0',
        'background: rgba(8, 12, 26, 0.72)',
        'z-index: 10020',
        'display: none',
        'align-items: center',
        'justify-content: center'
      ].join(';');

      analysisOverlay.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(148, 163, 184, 0.3); border-radius: 14px; padding: 20px 26px; display: flex; flex-direction: column; align-items: center; gap: 12px; color: #e2e8f0;">
          <div style="width: 38px; height: 38px; border-radius: 50%; border: 4px solid rgba(226,232,240,0.2); border-top-color: #e2e8f0; animation: labelAnalysisSpin 1s linear infinite;"></div>
          <div id="labelAnalysisOverlayMessage" style="font-size: 0.95rem; font-weight: 600;">Updating analysis...</div>
        </div>
      `;

      analysisOverlayMessage = analysisOverlay.querySelector('#labelAnalysisOverlayMessage');
      photoModal.appendChild(analysisOverlay);
    }

    function showAnalysisOverlay(message) {
      ensureAnalysisOverlay();
      if (analysisOverlayMessage) {
        analysisOverlayMessage.textContent = message || 'Updating analysis...';
      }
      analysisOverlay.style.display = 'flex';
    }

    function hideAnalysisOverlay() {
      if (analysisOverlay) {
        analysisOverlay.style.display = 'none';
      }
    }

    function setAllergenResultsPending(message) {
      allergenResultsContainer.innerHTML = `<div style="color:#a8b2d6;padding:12px;">${esc(message || 'Analyzing allergens...')}</div>`;
      allergenResultsSection.style.display = 'block';
    }

    async function runAllergenReanalysis({ showOverlay = false, statusMessage = 'Updating analysis...' } = {}) {
      if (!analysisResult || !Array.isArray(analysisResult.lines)) return;
      const transcript = refreshTranscriptFromWords();
      if (!transcript.length) {
        analysisResult.allergenFlags = [];
        renderAllLineWords();
        displayAllergenResults([]);
        return;
      }

      const requestId = ++reanalysisRequestId;
      analysisPending = true;
      if (analysisResult) {
        analysisResult.allergenAnalysisPending = true;
      }
      updateConfirmationUI(transcript.length);
      setAllergenResultsPending(statusMessage);
      statusDiv.textContent = statusMessage;
      statusDiv.style.color = '#a8b2d6';
      if (showOverlay) showAnalysisOverlay(statusMessage);

        try {
          const result = await analyzeAllergensWithLabelCropper(transcript);
          if (requestId !== reanalysisRequestId) return;
          const flags = result.success && result.data?.flags ? result.data.flags : [];
          analysisResult.allergenFlags = flags;
          reindexWordData();
          renderAllLineWords();
          displayAllergenResults(flags);
          statusDiv.textContent = 'Allergen and diet analysis complete!';
          statusDiv.style.color = '#4ade80';
      } catch (err) {
        if (requestId !== reanalysisRequestId) return;
        console.error('Allergen analysis failed:', err);
        statusDiv.textContent = 'Analysis update failed. Using previous results.';
        statusDiv.style.color = '#f59e0b';
      } finally {
        if (requestId === reanalysisRequestId) {
          if (analysisResult) {
            analysisResult.allergenAnalysisPending = false;
          }
          analysisPending = false;
          updateConfirmationUI(transcript.length);
        }
        if (showOverlay) hideAnalysisOverlay();
      }
    }

    function cancelPendingReanalysis() {
      reanalysisRequestId += 1;
      analysisPending = false;
      hideAnalysisOverlay();
    }

    function handleLineWordsChanged(lineIdx) {
      setLineConfirmationState(lineIdx, false);
      refreshTranscriptFromWords();
      reindexWordData();
      analysisResult.allergenFlags = [];
      renderAllLineWords();
      runAllergenReanalysis({ showOverlay: true, statusMessage: 'Updating analysis...' });
    }

    function buildLineText(lineIdx) {
      const wordData = lineWordDataMap[lineIdx] || [];
      return wordData
        .map((word, idx) => ({ word, idx }))
        .sort((a, b) => (a.word.centerPct - b.word.centerPct) || (a.idx - b.idx))
        .map(entry => entry.word.text)
        .filter(Boolean)
        .join(' ')
        .trim();
    }

    function layoutLineWords(lineIdx) {
      const container = lineTextContainers[lineIdx];
      if (!container) return;
      const textDiv = container.textDiv;
      const wordData = lineWordDataMap[lineIdx] || [];
      const totalChars = wordData.reduce((sum, word) => sum + (word.text ? word.text.length : 0), 0);
      const availableWidth = textDiv.clientWidth || 1;
      const baseFontSize = window.innerWidth < 600 ? 10 : 11;
      const computedSize = Math.floor((availableWidth / Math.max(totalChars, 1)) * 1.6);
      const fontSize = Math.max(6, Math.min(baseFontSize, computedSize));
      wordData.forEach((word, idx) => {
        const span = textDiv.querySelector(`span[data-word-idx="${idx}"]`);
        if (!span) return;
        span.style.left = `${word.centerPct}%`;
        span.style.transform = 'translateX(-50%)';
        span.style.top = '0px';
        span.style.fontSize = `${fontSize}px`;
      });
      textDiv.style.height = `${Math.round(fontSize * 1.6)}px`;
    }

    function renderLineWords(lineIdx) {
      const container = lineTextContainers[lineIdx];
      if (!container) return;
      const textDiv = container.textDiv;
      const wordData = lineWordDataMap[lineIdx] || [];
      textDiv.innerHTML = '';
      wordData.forEach((word, idx) => {
        const span = document.createElement('span');
        span.textContent = word.text;
        span.dataset.globalIndex = word.globalIndex;
        span.dataset.wordIdx = idx;
        span.style.cssText = 'position:absolute;color:#e2e8f0;white-space:nowrap;font-weight:500;cursor:text;';
        span.addEventListener('click', (event) => {
          event.stopPropagation();
          if (activeWordEditor) return;
          openWordEditor(lineIdx, idx, word.centerPct);
        });
        wordSpanMap[word.globalIndex] = span;
        textDiv.appendChild(span);
      });
      requestAnimationFrame(() => layoutLineWords(lineIdx));
    }

    function renderAllLineWords() {
      wordSpanMap = {};
      Object.keys(lineTextContainers).forEach(key => {
        const lineIdx = Number(key);
        if (!Number.isNaN(lineIdx)) {
          renderLineWords(lineIdx);
        }
      });
      applyAllergenHighlighting(Array.isArray(analysisResult?.allergenFlags) ? analysisResult.allergenFlags : []);
    }

    function openWordEditor(lineIdx, wordIdx = null, centerPct = 50) {
      const container = lineTextContainers[lineIdx];
      if (!container) return;
      const textDiv = container.textDiv;
      const safeCenter = Math.max(0, Math.min(100, centerPct));
      if (activeWordEditor) {
        return;
      }

      const editorWrap = document.createElement('div');
      editorWrap.style.cssText = [
        'position:absolute',
        'left:' + safeCenter + '%',
        'top:0',
        'transform:translateX(-50%)',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'gap:6px',
        'z-index:3'
      ].join(';');
      editorWrap.addEventListener('click', (event) => event.stopPropagation());

      const originalRawText = wordIdx !== null ? (lineWordDataMap[lineIdx]?.[wordIdx]?.text || '') : '';
      const hasTrailingComma = wordIdx !== null && originalRawText.endsWith(',');
      const editableText = hasTrailingComma ? originalRawText.slice(0, -1) : originalRawText;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = wordIdx !== null ? editableText : '';
      input.placeholder = wordIdx !== null ? 'Edit word' : 'Add word';
      input.style.cssText = 'min-width:70px;max-width:160px;padding:4px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.7);background:#0b1020;color:#fff;font-size:12px;';
      input.addEventListener('click', (event) => event.stopPropagation());

      const actionRow = document.createElement('div');
      actionRow.style.cssText = 'display:flex;gap:8px;';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save';
      saveBtn.style.cssText = 'padding:4px 10px;border-radius:6px;border:none;background:#22c55e;color:#0b1020;font-size:11px;font-weight:700;cursor:pointer;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.6);background:transparent;color:#e2e8f0;font-size:11px;font-weight:600;cursor:pointer;';

      actionRow.appendChild(saveBtn);
      actionRow.appendChild(cancelBtn);
      editorWrap.appendChild(input);
      editorWrap.appendChild(actionRow);
      textDiv.appendChild(editorWrap);

      const originalPadding = textDiv.style.paddingBottom;
      textDiv.style.paddingBottom = '28px';

      const finish = (commit) => {
        if (!editorWrap.parentNode) return;
        const value = input.value.trim();
        editorWrap.remove();
        textDiv.style.paddingBottom = originalPadding;
        activeWordEditor = null;
        if (commit) {
          let didChange = false;
          if (wordIdx !== null) {
            const cleanedValue = value.replace(/,+$/, '');
            if (cleanedValue) {
              const nextText = hasTrailingComma ? `${cleanedValue},` : cleanedValue;
              if (nextText !== originalRawText) {
                lineWordDataMap[lineIdx][wordIdx].text = nextText;
                didChange = true;
              }
            }
          } else if (value) {
            lineWordDataMap[lineIdx].push({
              text: value,
              centerPct: safeCenter,
              hasPosition: true,
              globalIndex: nextGlobalWordIndex++
            });
            didChange = true;
          }
          if (didChange) {
            handleLineWordsChanged(lineIdx);
          }
        }
      };

      saveBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });

      activeWordEditor = { close: finish };
      input.focus();
      input.select();
    }

    function displayCroppedLines(lines, imageDataUrl, allergenFlags) {
      croppedLinesContainer.innerHTML = '';
      fullImageContainer.innerHTML = '';
      wordSpanMap = {};
      lineConfirmations = {};
      lineCardMap = {};
      lineConfirmButtons = {};
      lineWordDataMap = {};
      lineTextContainers = {};
      activeWordEditor = null;
      nextGlobalWordIndex = 0;
      analysisPending = false;
      let globalWordIndex = 0;
      lineLayoutHandlers = [];
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }

      lines.forEach((line, idx) => {
        lineConfirmations[idx] = false;
      });

      const sourceImg = new Image();
      sourceImg.src = imageDataUrl;

      sourceImg.onload = () => {
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = sourceImg.naturalWidth;
        fullCanvas.height = sourceImg.naturalHeight;
        const ctx = fullCanvas.getContext('2d');
        ctx.drawImage(sourceImg, 0, 0);

        const boxColor = '#4c5ad4';
        lines.forEach((line, lineIdx) => {
          const coords = line.crop_coordinates;
          const x = (coords.x_start / 100) * sourceImg.naturalWidth;
          const y = (coords.y_start / 100) * sourceImg.naturalHeight;
          const w = ((coords.x_end - coords.x_start) / 100) * sourceImg.naturalWidth;
          const h = ((coords.y_end - coords.y_start) / 100) * sourceImg.naturalHeight;

          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 6;
          ctx.strokeRect(x, y, w, h);

          ctx.fillStyle = boxColor;
          ctx.fillRect(x, y - 28, 36, 28);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 16px Arial';
          ctx.fillText(`${lineIdx + 1}`, x + 10, y - 8);
        });

        const fullImg = document.createElement('img');
        fullImg.src = fullCanvas.toDataURL('image/png');
        fullImg.style.cssText = 'width:100%;border-radius:8px;';
        fullImageContainer.appendChild(fullImg);
        fullImageSection.style.display = 'block';

        lines.forEach((line, lineIdx) => {
          const coords = line.crop_coordinates;
          const x = (coords.x_start / 100) * sourceImg.naturalWidth;
          const y = (coords.y_start / 100) * sourceImg.naturalHeight;
          const w = ((coords.x_end - coords.x_start) / 100) * sourceImg.naturalWidth;
          const h = ((coords.y_end - coords.y_start) / 100) * sourceImg.naturalHeight;

          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = w;
          cropCanvas.height = h;
          cropCanvas.getContext('2d').drawImage(sourceImg, x, y, w, h, 0, 0, w, h);

          const lineDiv = document.createElement('div');
          lineDiv.style.cssText = 'background:#1a1f35;border-radius:8px;padding:12px;display:flex;gap:12px;align-items:flex-start;';
          lineDiv.dataset.lineIdx = lineIdx;
          lineCardMap[lineIdx] = lineDiv;

          const lineContent = document.createElement('div');
          lineContent.style.cssText = 'flex:1;min-width:0;';

          const lineLabel = document.createElement('div');
          lineLabel.style.cssText = 'color:#a8b2d6;font-size:0.8rem;margin-bottom:8px;';
          lineLabel.innerHTML = `<span style="display:inline-block;width:8px;height:8px;background:${boxColor};border-radius:50%;margin-right:6px;"></span>Line ${line.line_number}`;
          lineContent.appendChild(lineLabel);

          const lineContentWrapper = document.createElement('div');
          lineContentWrapper.style.cssText = 'display:inline-block;max-width:100%;min-width:50%;';

          const cropImg = document.createElement('img');
          cropImg.src = cropCanvas.toDataURL('image/png');
          cropImg.style.cssText = 'width:100%;border-radius:4px;background:#000;display:block;';
          lineContentWrapper.appendChild(cropImg);

          const transcriptWords = line.text.split(/\s+/).filter(w => w.length > 0);
          const visionWords = line.words || [];

          if (transcriptWords.length > 0) {
            const textDiv = document.createElement('div');
            textDiv.style.cssText = 'margin-top:8px;position:relative;width:100%;';
            textDiv.dataset.lineIdx = lineIdx;
            textDiv.addEventListener('click', (event) => {
              if (activeWordEditor) return;
              if (event.target !== textDiv) return;
              const rect = textDiv.getBoundingClientRect();
              const clickPct = rect.width ? ((event.clientX - rect.left) / rect.width) * 100 : 50;
              openWordEditor(lineIdx, null, Math.max(0, Math.min(100, clickPct)));
            });

            const cropXStart = coords.x_start;
            const cropXEnd = coords.x_end;
            const cropWidth = cropXEnd - cropXStart;

            const usedVisionIndices = new Set();
            const wordData = transcriptWords.map((wordText, wordIdx) => {
              const cleanTranscript = wordText.toLowerCase().replace(/[^a-z0-9]/g, '');
              let bestMatch = null;
              let bestScore = 0;

              visionWords.forEach((vw, vi) => {
                if (usedVisionIndices.has(vi)) return;
                const cleanVision = vw.text.toLowerCase().replace(/[^a-z0-9]/g, '');
                let score = 0;
                if (cleanVision === cleanTranscript) score = 100;
                else if (cleanVision.includes(cleanTranscript) || cleanTranscript.includes(cleanVision)) {
                  score = 50 + Math.min(cleanVision.length, cleanTranscript.length);
                }
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = { vw, vi };
                }
              });

              if (bestMatch && bestScore > 0) {
                usedVisionIndices.add(bestMatch.vi);
                const wordCenterPct = (bestMatch.vw.x_start + bestMatch.vw.x_end) / 2;
                const centerPctInCrop = ((wordCenterPct - cropXStart) / cropWidth) * 100;
                return { text: wordText, centerPct: centerPctInCrop, hasPosition: true, globalIndex: globalWordIndex + wordIdx };
              }
              return { text: wordText, centerPct: 50, hasPosition: false, globalIndex: globalWordIndex + wordIdx };
            });

            lineWordDataMap[lineIdx] = wordData;
            lineTextContainers[lineIdx] = { textDiv };
            renderLineWords(lineIdx);
            globalWordIndex += transcriptWords.length;

            lineContentWrapper.appendChild(textDiv);

            lineLayoutHandlers.push(() => layoutLineWords(lineIdx));
            requestAnimationFrame(() => layoutLineWords(lineIdx));
          }

          lineContent.appendChild(lineContentWrapper);

          const confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          confirmBtn.className = 'lineConfirmBtn';
          confirmBtn.dataset.lineIdx = lineIdx;
          confirmBtn.style.cssText = `
            padding: 8px 16px;
            background: #f59e0b;
            border: 2px solid #d97706;
            border-radius: 6px;
            color: #fff;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
            flex-shrink: 0;
          `;
          confirmBtn.textContent = 'Confirm';
          lineConfirmButtons[lineIdx] = confirmBtn;

          confirmBtn.addEventListener('click', () => {
            const idx = parseInt(confirmBtn.dataset.lineIdx);
            setLineConfirmationState(idx, !lineConfirmations[idx], lines.length);
          });

          lineDiv.appendChild(lineContent);
          lineDiv.appendChild(confirmBtn);
          croppedLinesContainer.appendChild(lineDiv);
        });

        nextGlobalWordIndex = globalWordIndex;

        if (lineLayoutHandlers.length > 0) {
          resizeHandler = () => {
            lineLayoutHandlers.forEach(handler => handler());
          };
          window.addEventListener('resize', resizeHandler);
        }

        const resolvedFlags = Array.isArray(allergenFlags) ? allergenFlags : [];
        const shouldReanalyze = analysisResult?.allergenAnalysisPending === true
          || (!resolvedFlags.length && analysisResult?.allergenAnalysisPending !== false);
        analysisResult.allergenFlags = resolvedFlags;
        analysisResult.allergenAnalysisPending = shouldReanalyze;
        applyAllergenHighlighting(resolvedFlags);
        croppedLinesSection.style.display = 'block';
        preview.style.display = 'none';
      updateConfirmationUI(lines.length);
      if (shouldReanalyze) {
        requestAnimationFrame(() => {
          runAllergenReanalysis({ showOverlay: true, statusMessage: 'Analyzing ingredients...' });
        });
      }
      };
    }

    function applyAllergenHighlighting(flags) {
      flags.forEach(flag => {
        const indices = Array.isArray(flag.word_indices) ? flag.word_indices : [flag.word_indices];
        const isContained = flag.risk_type === 'contained';
        const color = isContained ? '#ef4444' : '#fbbf24';
        indices.forEach(idx => {
          const span = wordSpanMap[idx];
          if (span) {
            span.style.textDecoration = 'underline';
            span.style.textDecorationColor = color;
            span.style.textDecorationThickness = '2px';
            span.style.fontWeight = '600';
          }
        });
      });
    }

    function displayAllergenResults(allergenFlags) {
      if (!Array.isArray(allergenFlags) || allergenFlags.length === 0) {
        allergenResultsContainer.innerHTML = '<div style="color:#4ade80;padding:12px;">✓ No allergens or diet violations detected</div>';
        allergenResultsSection.style.display = 'block';
        return;
      }

      let html = '';
      allergenFlags.forEach(flag => {
        const isContained = flag.risk_type === 'contained';
        const bgColor = isContained ? 'rgba(239,68,68,0.15)' : 'rgba(251,191,36,0.15)';
        const borderColor = isContained ? 'rgba(239,68,68,0.4)' : 'rgba(251,191,36,0.4)';
        const riskLabel = isContained ? 'CONTAINS' : 'MAY CONTAIN';
        const types = [...(flag.allergens || []), ...(flag.diets || [])].join(', ');

        html += `
          <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:12px;margin-bottom:8px;">
            <div style="font-weight:600;color:#fff;margin-bottom:4px;">${flag.ingredient}</div>
            <div style="font-size:0.85rem;color:#a8b2d6;">
              <span style="color:${isContained ? '#ef4444' : '#fbbf24'}">${riskLabel}</span> • ${types}
            </div>
          </div>
        `;
      });
      allergenResultsContainer.innerHTML = html;
      allergenResultsSection.style.display = 'block';
    }

    retakeBtn.addEventListener('click', () => {
      cancelPendingReanalysis();
      capturedPhoto = null;
      analysisResult = null;
      preview.style.display = 'none';
      croppedLinesSection.style.display = 'none';
      allergenResultsSection.style.display = 'none';
      applyButtonContainer.style.display = 'none';
      buttonsContainer.style.display = 'flex';
      showButtons(cameraBtn, uploadBtn);
      statusDiv.textContent = '';
    });

    async function applyAnalysisResults(frontImageDataUrl = null, productName = null) {
      if (!analysisResult) return;

      const flags = analysisResult.allergenFlags || [];
      const containedAllergens = new Set();
      const mayContainAllergens = new Set();
      const violatedDiets = new Set();
      const mayContainDiets = new Set();
      const confirmedLines = Array.isArray(analysisResult.lines)
        ? analysisResult.lines.filter((_, idx) => lineConfirmations[idx])
        : [];
      const fallbackLines = Array.isArray(analysisResult.transcript) ? analysisResult.transcript : [];
      const ingredientText = confirmedLines.length
        ? confirmedLines.map(line => line.text).join(' ')
        : fallbackLines.join(' ');
      const ingredientLines = (confirmedLines.length ? confirmedLines.map(line => line.text) : fallbackLines)
        .map(text => String(text || '').trim())
        .filter(Boolean);
      const labelImage = analysisResult.correctedImage || capturedPhoto || '';

      const dietOptions = DIETS;
      const normalizeAllergenKey = (value) => normalizeAllergen(value);
      const normalizeDietName = (diet) =>
        normalizeDietLabel(diet) || String(diet || '').trim();
      const addMayContainDiets = (list) => {
        (Array.isArray(list) ? list : []).forEach((diet) => {
          const normalized = normalizeDietName(diet);
          if (normalized) mayContainDiets.add(normalized);
        });
      };
      const allergenToDiets = {};
      dietOptions.forEach((diet) => {
        getDietAllergenConflicts(diet).forEach((allergen) => {
          if (!allergenToDiets[allergen]) {
            allergenToDiets[allergen] = [];
          }
          if (!allergenToDiets[allergen].includes(diet)) {
            allergenToDiets[allergen].push(diet);
          }
        });
      });

      const resolveFlagAllergens = (list) =>
        Array.isArray(list) ? list : [];

      flags.forEach(flag => {
        const flagAllergens = Array.isArray(flag.allergens) ? flag.allergens : [];
        const flagDiets = Array.isArray(flag.diets) ? flag.diets : [];
        const isContained = flag.risk_type === 'contained';
        const resolvedAllergens = resolveFlagAllergens(flagAllergens);

        if (isContained) {
          resolvedAllergens.forEach(a => {
            const normalized = normalizeAllergenKey(a);
            if (normalized) {
              containedAllergens.add(normalized);
              const affectedDiets = allergenToDiets[normalized] || [];
              affectedDiets.forEach(d => violatedDiets.add(d));
            }
          });
          flagDiets.forEach(d => {
            const normalized = normalizeDietName(d);
            if (normalized) violatedDiets.add(normalized);
          });
        } else {
          resolvedAllergens.forEach(a => {
            const normalized = normalizeAllergenKey(a);
            if (normalized) {
              mayContainAllergens.add(normalized);
              const affectedDiets = allergenToDiets[normalized] || [];
              affectedDiets.forEach(d => mayContainDiets.add(d));
            }
          });
          addMayContainDiets(flagDiets);
        }
      });

      containedAllergens.forEach(a => mayContainAllergens.delete(a));
      violatedDiets.forEach(d => mayContainDiets.delete(d));

      const compliantDiets = dietOptions.filter(d => !violatedDiets.has(d) && !mayContainDiets.has(d));

      let compressedImage = '';
      if (frontImageDataUrl) {
        compressedImage = await compressImage(frontImageDataUrl, 1200, 0.92);
      }

      if (skipRowUpdates) {
        if (onApplyResults) {
          await onApplyResults({
            ingredientName,
            ingredientText,
            allergens: Array.from(containedAllergens),
            mayContainAllergens: Array.from(mayContainAllergens),
            diets: compliantDiets,
            mayContainDiets: Array.from(mayContainDiets),
            brandImage: compressedImage,
            ingredientsImage: labelImage,
            productName: productName || ''
          });
        }
        return;
      }

      const data = collectAiTableData();
      if (data[rowIdx]) {
        data[rowIdx].allergens = Array.from(containedAllergens);
        data[rowIdx].mayContainAllergens = Array.from(mayContainAllergens);
        data[rowIdx].diets = compliantDiets;
        data[rowIdx].mayContainDiets = Array.from(mayContainDiets);
        data[rowIdx].ingredientsImage = labelImage;
        data[rowIdx].ingredientsList = ingredientLines;
        data[rowIdx].confirmed = false;
        data[rowIdx].aiDetectedAllergens = Array.from(containedAllergens);
        data[rowIdx].aiDetectedMayContainAllergens = Array.from(mayContainAllergens);
        data[rowIdx].aiDetectedDiets = data[rowIdx].diets;
        data[rowIdx].aiDetectedMayContainDiets = Array.from(mayContainDiets);

        if (frontImageDataUrl) {
          data[rowIdx].brandImage = compressedImage;

          if (productName) {
            if (!data[rowIdx].brands) {
              data[rowIdx].brands = [];
            }
            const newBrand = {
              name: productName,
              brandImage: compressedImage,
              ingredientsImage: labelImage,
              ingredientsList: ingredientLines,
              allergens: Array.from(containedAllergens),
              mayContainAllergens: Array.from(mayContainAllergens),
              diets: data[rowIdx].diets,
              mayContainDiets: Array.from(mayContainDiets)
            };
            data[rowIdx].brands.push(newBrand);
          }
        }

        if (aiAssistState.photoAnalysisResults && aiAssistState.photoAnalysisResults[rowIdx]) {
          delete aiAssistState.photoAnalysisResults[rowIdx];
        }

        renderAiTable(data);
        aiAssistSetStatus('Photo analysis applied successfully!', 'success');
        aiAssistState.savedToDish = false;
      }

      hidePhotoAnalysisLoadingInRow(rowIdx);
    }

    applyBtn.addEventListener('click', () => {
      if (!analysisResult) return;

      const frontModal = document.createElement('div');
      frontModal.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'right: 0',
        'bottom: 0',
        'background: rgba(0,0,0,0.95)',
        'z-index: 10002',
        'display: flex',
        'flex-direction: column',
        'align-items: center',
        'padding: 20px',
        'overflow-y: auto'
      ].join(';');

      frontModal.innerHTML = `
        <div style="width:100%;max-width:500px;display:flex;flex-direction:column;gap:16px">
          <div style="text-align:center">
            <h3 style="margin:0 0 8px 0;font-size:1.3rem;color:#fff">Capture Item Front</h3>
            <p style="margin:0;color:#a8b2d6;font-size:0.9rem">Take a photo of the front of the product for the thumbnail</p>
          </div>

          <div style="position:relative;background:#000;border-radius:12px;overflow:hidden;min-height:200px">
            <video id="frontCameraVideo" autoplay playsinline muted style="width:100%;max-height:50vh;display:none;object-fit:cover"></video>
            <img id="frontPhotoPreview" style="width:100%;max-height:50vh;object-fit:contain;display:none" alt="Preview">
            <div id="frontPlaceholder" style="display:flex;align-items:center;justify-content:center;height:200px;color:#64748b">
              No image selected
            </div>
          </div>

          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button type="button" class="btn frontCameraBtn" style="background:#4c5ad4;padding:10px 20px">📷 Use Camera</button>
            <button type="button" class="btn frontUploadBtn" style="background:#4c5ad4;padding:10px 20px">📁 Upload Photo</button>
            <button type="button" class="btn frontCaptureBtn" style="background:#17663a;padding:10px 20px;display:none">📸 Capture</button>
            <input type="file" id="frontFileInput" accept="image/*" style="display:none">
          </div>

          <div class="frontAnalyzingArea" style="display:none;padding:12px;background:rgba(76,90,212,0.1);border-radius:8px;border:1px solid rgba(76,90,212,0.3)">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:20px;height:20px;border:2px solid #4c5ad4;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite"></div>
              <span style="color:#a8b2d6;font-size:0.9rem">Identifying product...</span>
            </div>
          </div>

          <div class="frontProductNameArea" style="display:none;flex-direction:column;gap:8px">
            <label style="color:#a8b2d6;font-size:0.85rem">Product Name</label>
            <input type="text" class="frontProductNameInput" placeholder="Enter product name" style="width:100%;padding:12px;border-radius:8px;border:1px solid rgba(148,163,184,0.3);background:rgba(0,0,0,0.3);color:#fff;font-size:1rem;box-sizing:border-box">
            <div class="frontProductNameHint" style="color:#64748b;font-size:0.8rem;font-style:italic"></div>
          </div>

          <div class="frontActionBtns" style="display:none;flex-direction:column;gap:12px;justify-content:center;margin-top:8px">
            <div style="display:flex;gap:12px;justify-content:center">
              <button type="button" class="btn frontApplyBtn" style="background:#17663a;padding:12px 24px;font-size:1rem">✓ Save & Apply Results</button>
              <button type="button" class="btn frontRetakeBtn" style="background:#f59e0b;padding:12px 24px">📷 Retake Photo</button>
            </div>
            <div style="display:flex;justify-content:center">
              <button type="button" class="btn frontCancelBtn" style="background:#ef4444;padding:12px 24px">Cancel</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(frontModal);

      const frontVideo = frontModal.querySelector('#frontCameraVideo');
      const frontPreview = frontModal.querySelector('#frontPhotoPreview');
      const frontPlaceholder = frontModal.querySelector('#frontPlaceholder');
      const frontCameraBtn = frontModal.querySelector('.frontCameraBtn');
      const frontUploadBtn = frontModal.querySelector('.frontUploadBtn');
      const frontCaptureBtn = frontModal.querySelector('.frontCaptureBtn');
      const frontFileInput = frontModal.querySelector('#frontFileInput');
      const frontApplyBtn = frontModal.querySelector('.frontApplyBtn');
      const frontRetakeBtn = frontModal.querySelector('.frontRetakeBtn');
      const frontCancelBtn = frontModal.querySelector('.frontCancelBtn');
      const frontActionBtns = frontModal.querySelector('.frontActionBtns');
      const frontAnalyzingArea = frontModal.querySelector('.frontAnalyzingArea');
      const frontProductNameArea = frontModal.querySelector('.frontProductNameArea');
      const frontProductNameInput = frontModal.querySelector('.frontProductNameInput');
      const frontProductNameHint = frontModal.querySelector('.frontProductNameHint');
      const frontAnalyzingText = frontAnalyzingArea?.querySelector('span');

      let frontStream = null;
      let frontCapturedPhoto = null;
      let detectedProductName = null;

      async function analyzeFrontImage(imageDataUrl) {
        frontAnalyzingArea.style.display = 'block';
        frontProductNameArea.style.display = 'none';
        frontActionBtns.style.display = 'none';

        try {
          const response = await fetch('https://fgoiyycctnwnghrvsilt.supabase.co/functions/v1/analyze-product-front', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageDataUrl })
          });

          if (!response.ok) {
            throw new Error('Failed to analyze image');
          }

          const result = await response.json();
          detectedProductName = result.productName || '';
          const confidence = result.confidence || 'low';

          frontAnalyzingArea.style.display = 'none';
          frontProductNameArea.style.display = 'flex';
          frontActionBtns.style.display = 'flex';

          if (detectedProductName && confidence !== 'low') {
            frontProductNameInput.value = detectedProductName;
            frontProductNameHint.textContent = confidence === 'high'
              ? 'Product identified automatically'
              : 'Please verify the product name';
            frontProductNameHint.style.color = confidence === 'high' ? '#22c55e' : '#f59e0b';
          } else {
            frontProductNameInput.value = '';
            frontProductNameHint.textContent = 'Could not identify product - please enter the name';
            frontProductNameHint.style.color = '#ef4444';
            frontProductNameInput.focus();
          }
        } catch (err) {
          frontAnalyzingArea.style.display = 'none';
          frontProductNameArea.style.display = 'flex';
          frontActionBtns.style.display = 'flex';
          frontProductNameInput.value = '';
          frontProductNameHint.textContent = 'Could not analyze image - please enter product name';
          frontProductNameHint.style.color = '#ef4444';
          frontProductNameInput.focus();
        }
      }

      const closeFrontModal = () => {
        if (frontStream) {
          frontStream.getTracks().forEach(track => track.stop());
        }
        if (frontModal.parentNode) frontModal.remove();
      };

      frontCameraBtn.addEventListener('click', async () => {
        try {
          frontStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
          });
          frontVideo.srcObject = frontStream;
          frontVideo.style.display = 'block';
          frontPreview.style.display = 'none';
          frontPlaceholder.style.display = 'none';
          frontCameraBtn.style.display = 'none';
          frontUploadBtn.style.display = 'none';
          frontCaptureBtn.style.display = 'inline-block';
        } catch (err) {
          alert('Could not access camera: ' + err.message);
        }
      });

      frontCaptureBtn.addEventListener('click', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = frontVideo.videoWidth;
        canvas.height = frontVideo.videoHeight;
        canvas.getContext('2d').drawImage(frontVideo, 0, 0);
        frontCapturedPhoto = canvas.toDataURL('image/jpeg', 0.85);

        if (frontStream) {
          frontStream.getTracks().forEach(track => track.stop());
          frontStream = null;
        }

        frontVideo.style.display = 'none';
        frontPreview.src = frontCapturedPhoto;
        frontPreview.style.display = 'block';
        frontCaptureBtn.style.display = 'none';
        frontCameraBtn.style.display = 'none';
        frontUploadBtn.style.display = 'none';

        await analyzeFrontImage(frontCapturedPhoto);
      });

      frontUploadBtn.addEventListener('click', () => frontFileInput.click());

      frontFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
          frontCapturedPhoto = ev.target.result;
          frontPreview.src = frontCapturedPhoto;
          frontPreview.style.display = 'block';
          frontVideo.style.display = 'none';
          frontPlaceholder.style.display = 'none';
          frontCameraBtn.style.display = 'none';
          frontUploadBtn.style.display = 'none';

          await analyzeFrontImage(frontCapturedPhoto);
        };
        reader.readAsDataURL(file);
      });

      frontApplyBtn.addEventListener('click', async () => {
        const productName = frontProductNameInput.value.trim();
        frontApplyBtn.disabled = true;
        frontRetakeBtn.disabled = true;
        frontCancelBtn.disabled = true;
        frontProductNameInput.disabled = true;
        frontApplyBtn.textContent = 'Saving...';
        frontAnalyzingArea.style.display = 'block';
        if (frontAnalyzingText) {
          frontAnalyzingText.textContent = 'Applying results...';
        }
        try {
          await applyAnalysisResults(frontCapturedPhoto, productName);
          closeFrontModal();
          closeModal();
        } catch (err) {
          console.error('Failed to apply analysis results', err);
          frontAnalyzingArea.style.display = 'none';
          frontProductNameHint.textContent = 'Failed to apply results. Please try again.';
          frontProductNameHint.style.color = '#f87171';
          frontApplyBtn.textContent = '✓ Save & Apply Results';
          frontApplyBtn.disabled = false;
          frontRetakeBtn.disabled = false;
          frontCancelBtn.disabled = false;
          frontProductNameInput.disabled = false;
        }
      });

      frontRetakeBtn.addEventListener('click', () => {
        frontCapturedPhoto = null;
        detectedProductName = null;
        frontPreview.style.display = 'none';
        frontPreview.src = '';
        frontPlaceholder.style.display = 'flex';
        frontActionBtns.style.display = 'none';
        frontAnalyzingArea.style.display = 'none';
        frontProductNameArea.style.display = 'none';
        frontProductNameInput.value = '';
        frontCameraBtn.style.display = 'inline-block';
        frontUploadBtn.style.display = 'inline-block';
        frontFileInput.value = '';
      });

      frontCancelBtn.addEventListener('click', closeFrontModal);
    });

    cancelBtn.addEventListener('click', closeModal);

    photoModal.addEventListener('click', (e) => {
      if (e.target === photoModal) closeModal();
    });

    if (reportPhotoIssueBtn) {
      reportPhotoIssueBtn.addEventListener('click', () => {
        const reportModal = document.createElement('div');
        reportModal.style.cssText = [
          'position: fixed',
          'top: 0',
          'left: 0',
          'right: 0',
          'bottom: 0',
          'background: rgba(0,0,0,0.8)',
          'z-index: 10002',
          'display: flex',
          'align-items: center',
          'justify-content: center'
        ].join(';');

        reportModal.innerHTML = `
          <div style="background:#1e293b;padding:24px;border-radius:12px;width:90%;max-width:500px;border:1px solid rgba(148,163,184,0.2);">
            <h3 style="color:#fff;margin:0 0 16px 0;">Report Issue</h3>
            <p style="color:#94a3b8;margin-bottom:16px;font-size:0.9rem;">Please describe what's wrong with the analysis.</p>
            <textarea style="width:100%;height:100px;background:rgba(0,0,0,0.2);border:1px solid rgba(148,163,184,0.2);border-radius:8px;color:#fff;padding:12px;margin-bottom:16px;resize:vertical;" placeholder="e.g. The ingredient list is missing items, wrong allergens detected..."></textarea>
            <div style="display:flex;justify-content:flex-end;gap:12px;">
              <button class="cancelReportBtn" style="padding:8px 16px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;cursor:pointer;">Cancel</button>
              <button class="sendReportBtn" style="padding:8px 16px;background:#dc2626;border:none;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;">Send Report</button>
            </div>
          </div>
        `;

        document.body.appendChild(reportModal);

        reportModal.querySelector('.cancelReportBtn').onclick = () => document.body.removeChild(reportModal);
        reportModal.querySelector('.sendReportBtn').onclick = async function () {
          const msg = reportModal.querySelector('textarea').value.trim();
          if (!msg) return;
          this.textContent = 'Sending...';
          this.disabled = true;

          try {
            const client = window.supabaseClient;
            if (!client || !client.functions || typeof client.functions.invoke !== 'function') {
              throw new Error('Supabase client not ready.');
            }
            const payload = {
              message: msg,
              context: 'ingredient-label-capture',
              ingredientName,
              url: window.location.href,
              analysisFlags: analysisResult?.allergenFlags || []
            };
            const { error } = await client.functions.invoke('report-issue', { body: payload });
            if (error) throw error;
            document.body.removeChild(reportModal);
            alert('Thanks! Your report was sent.');
          } catch (err) {
            console.error('Report issue failed:', err);
            alert('Unable to send the report right now. Please try again.');
            this.textContent = 'Send Report';
            this.disabled = false;
          }
        };
      });
    }
  }

  window.showIngredientPhotoUploadModal = showIngredientPhotoUploadModal;
  window.analyzeIngredientPhoto = analyzeIngredientPhoto;
})(allergenConfig);
