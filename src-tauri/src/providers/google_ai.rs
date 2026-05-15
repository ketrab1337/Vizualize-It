use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::{
    BatchPoll, BatchSubmit, GeneratedImage, GenerationConfig, ImageGenerator,
};
use crate::commands::keyring::get_api_key;

const ENDPOINT_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

// ── Request structures ────────────────────────────────────────────────────

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenConfig,
    #[serde(rename = "systemInstruction", skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiSystemInstruction>,
}

#[derive(Serialize)]
struct GeminiSystemInstruction {
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum GeminiPart {
    Text { text: String },
    Inline {
        #[serde(rename = "inlineData")]
        inline_data: GeminiInlineData,
    },
}

#[derive(Serialize)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Serialize)]
struct GeminiGenConfig {
    #[serde(rename = "responseModalities")]
    response_modalities: Vec<String>,
    #[serde(rename = "candidateCount", skip_serializing_if = "Option::is_none")]
    candidate_count: Option<u8>,
}

// ── Response structures ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    error: Option<GeminiApiError>,
}

#[derive(Deserialize)]
struct GeminiApiError {
    message: String,
    code: Option<i32>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiRespContent>,
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct GeminiRespContent {
    parts: Vec<GeminiRespPart>,
}

#[derive(Deserialize)]
struct GeminiRespPart {
    #[serde(rename = "inlineData")]
    inline_data: Option<GeminiRespInlineData>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct GeminiRespInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

// ── Batch API response structures ─────────────────────────────────────────

/// Long-running operation zwracane przez `:batchGenerateContent` i polling endpoint.
#[derive(Deserialize)]
struct BatchOperation {
    name: Option<String>,
    metadata: Option<serde_json::Value>,
    done: Option<bool>,
    response: Option<serde_json::Value>,
    error: Option<BatchOperationError>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct BatchOperationError {
    message: String,
    code: Option<i32>,
}

// ── Provider ─────────────────────────────────────────────────────────────

pub struct GoogleAiProvider {
    pub model: String,
}

impl GoogleAiProvider {
    pub fn nano_banana_2() -> Self {
        Self { model: "gemini-3.1-flash-image-preview".to_string() }
    }

    pub fn nano_banana_pro() -> Self {
        Self { model: "gemini-3-pro-image-preview".to_string() }
    }

    fn generate_endpoint(&self) -> String {
        format!("{ENDPOINT_BASE}/models/{}:generateContent", self.model)
    }

    fn batch_endpoint(&self) -> String {
        format!("{ENDPOINT_BASE}/models/{}:batchGenerateContent", self.model)
    }
}

fn mask_key_in_error(msg: &str) -> String {
    let safe = if let Some(pos) = msg.find("?key=") {
        format!("{}?key=***", &msg[..pos])
    } else {
        msg.to_string()
    };
    format!("Błąd sieci: {safe}")
}

fn map_api_error(status: u16, body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(msg) = v
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            return format!("Błąd API Google ({status}): {msg}");
        }
    }
    match status {
        400 => format!("Błąd API (400): nieprawidłowe żądanie — sprawdź prompt."),
        401 | 403 => format!("Błąd API ({status}): nieprawidłowy klucz Google AI."),
        429 => "Błąd API (429): przekroczono limit zapytań — spróbuj za chwilę.".into(),
        500..=599 => format!("Błąd serwera Google ({status}) — spróbuj ponownie."),
        _ => format!("Błąd API ({status})."),
    }
}

async fn read_key() -> Result<String, String> {
    let key = get_api_key("google_ai".to_string())
        .await?
        .ok_or_else(|| "Klucz Google AI nie jest ustawiony.".to_string())?;
    if key.is_empty() {
        return Err("Klucz Google AI jest pusty.".to_string());
    }
    Ok(key)
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Błąd inicjalizacji klienta HTTP: {e}"))
}

/// Buduje wewnętrzne `GenerateContentRequest` (taki sam dla live i batch).
fn build_request(config: &GenerationConfig) -> GeminiRequest {
    let mut parts: Vec<GeminiPart> = Vec::new();

    if let Some(bg) = &config.background_image {
        parts.push(GeminiPart::Inline {
            inline_data: GeminiInlineData {
                mime_type: bg.mime_type.clone(),
                data: bg.data.clone(),
            },
        });
    }

    if let Some(svg) = &config.svg_image {
        parts.push(GeminiPart::Inline {
            inline_data: GeminiInlineData {
                mime_type: svg.mime_type.clone(),
                data: svg.data.clone(),
            },
        });
    }

    let full_prompt = format!("{} {}", config.prompt, config.format.to_prompt_suffix());
    parts.push(GeminiPart::Text { text: full_prompt });

    for img in &config.material_images {
        parts.push(GeminiPart::Inline {
            inline_data: GeminiInlineData {
                mime_type: img.mime_type.clone(),
                data: img.data.clone(),
            },
        });
    }

    for img in &config.reference_images {
        parts.push(GeminiPart::Inline {
            inline_data: GeminiInlineData {
                mime_type: img.mime_type.clone(),
                data: img.data.clone(),
            },
        });
    }

    let system_instruction = config
        .user_prompt
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| GeminiSystemInstruction {
            parts: vec![GeminiPart::Text { text: s.to_string() }],
        });

    GeminiRequest {
        contents: vec![GeminiContent {
            role: "user".to_string(),
            parts,
        }],
        generation_config: GeminiGenConfig {
            response_modalities: vec!["IMAGE".to_string()],
            candidate_count: if config.count > 1 { Some(config.count) } else { None },
        },
        system_instruction,
    }
}

/// Wyciąga obrazy z `GenerateContentResponse` (tej samej struktury co w live API).
fn extract_images_from_response(value: &serde_json::Value) -> Result<Vec<GeneratedImage>, String> {
    let resp: GeminiResponse = serde_json::from_value(value.clone())
        .map_err(|e| format!("Błąd parsowania odpowiedzi: {e}"))?;

    if let Some(err) = resp.error {
        return Err(format!(
            "Błąd API Google{}: {}",
            err.code.map(|c| format!(" ({c})")).unwrap_or_default(),
            err.message
        ));
    }

    let candidates = resp.candidates.unwrap_or_default();
    let mut images = Vec::new();
    for candidate in candidates {
        if let Some(reason) = &candidate.finish_reason {
            if reason == "SAFETY" || reason == "RECITATION" {
                return Err(format!(
                    "Generowanie przerwane przez filtry bezpieczeństwa ({reason})."
                ));
            }
        }
        let content = match candidate.content {
            Some(c) => c,
            None => continue,
        };
        for part in content.parts {
            if let Some(inline) = part.inline_data {
                let data = base64::engine::general_purpose::STANDARD
                    .decode(&inline.data)
                    .map_err(|e| format!("Błąd dekodowania base64: {e}"))?;
                images.push(GeneratedImage {
                    data,
                    width: 0,
                    height: 0,
                    format: inline.mime_type,
                });
            }
            let _ = part.text;
        }
    }
    Ok(images)
}

#[async_trait::async_trait]
impl ImageGenerator for GoogleAiProvider {
    async fn generate(&self, config: GenerationConfig) -> Result<Vec<GeneratedImage>, String> {
        let key = read_key().await?;
        let request = build_request(&config);

        let url = format!("{}?key={}", self.generate_endpoint(), key);
        let client = build_client()?;
        let resp = client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| mask_key_in_error(&e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let value: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania odpowiedzi API: {e}"))?;

        let images = extract_images_from_response(&value)?;
        if images.is_empty() {
            return Err("API zwróciło odpowiedź bez obrazów. Sprawdź prompt.".to_string());
        }
        Ok(images)
    }

    async fn edit(
        &self,
        image: Vec<u8>,
        prompt: String,
        references: Vec<crate::providers::MaterialImage>,
    ) -> Result<GeneratedImage, String> {
        let key = read_key().await?;

        let image_b64 = base64::engine::general_purpose::STANDARD.encode(&image);
        let mime_type = if image.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            "image/png"
        } else if image.starts_with(&[0xFF, 0xD8]) {
            "image/jpeg"
        } else if image.len() >= 4 && &image[..4] == b"RIFF" {
            "image/webp"
        } else {
            "image/png"
        };

        let mut parts: Vec<GeminiPart> = Vec::with_capacity(2 + references.len());
        parts.push(GeminiPart::Inline {
            inline_data: GeminiInlineData {
                mime_type: mime_type.to_string(),
                data: image_b64,
            },
        });
        // Zdjęcia referencyjne — dołączane przed promptem jako dodatkowy kontekst.
        for r in references {
            parts.push(GeminiPart::Inline {
                inline_data: GeminiInlineData {
                    mime_type: r.mime_type,
                    data: r.data,
                },
            });
        }
        parts.push(GeminiPart::Text { text: prompt });

        let request = GeminiRequest {
            contents: vec![GeminiContent {
                role: "user".to_string(),
                parts,
            }],
            generation_config: GeminiGenConfig {
                response_modalities: vec!["IMAGE".to_string()],
                candidate_count: None,
            },
            system_instruction: None,
        };

        let url = format!("{}?key={}", self.generate_endpoint(), key);
        let client = build_client()?;
        let resp = client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| mask_key_in_error(&e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let value: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania odpowiedzi API: {e}"))?;

        let images = extract_images_from_response(&value)?;
        images
            .into_iter()
            .next()
            .ok_or_else(|| "API nie zwróciło obrazu. Sprawdź prompt.".to_string())
    }

    async fn submit_batch(&self, config: GenerationConfig) -> Result<BatchSubmit, String> {
        let key = read_key().await?;
        let client = build_client()?;
        let request = build_request(&config);

        // Inlined batch — pojedyncze żądanie wbudowane w wywołanie tworzenia batcha.
        // Struktura: batch.inputConfig.requests.requests[].request
        let body = serde_json::json!({
            "batch": {
                "displayName": "vizualize-it-batch",
                "inputConfig": {
                    "requests": {
                        "requests": [
                            {
                                "request": request,
                                "metadata": { "key": "vizualizeit-request" }
                            }
                        ]
                    }
                }
            }
        });

        let url = format!("{}?key={}", self.batch_endpoint(), key);
        let resp = client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| mask_key_in_error(&e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let op: BatchOperation = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania odpowiedzi batcha: {e}"))?;

        let name = op
            .name
            .ok_or_else(|| "API nie zwróciło nazwy zadania batch.".to_string())?;

        Ok(BatchSubmit {
            batch_id: name,
            input_file_id: None,
        })
    }

    async fn poll_batch(&self, batch_id: &str) -> Result<BatchPoll, String> {
        let key = read_key().await?;
        let client = build_client()?;

        // batch_id ma format "batches/XXX" — używamy go jako resource name.
        let url = format!("{ENDPOINT_BASE}/{batch_id}?key={}", key);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| mask_key_in_error(&e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let op: BatchOperation = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania statusu batcha: {e}"))?;

        // Stan może być w metadata.state lub w innym miejscu — szukamy w obu.
        let state = op
            .metadata
            .as_ref()
            .and_then(|m| m.get("state"))
            .and_then(|s| s.as_str())
            .unwrap_or("");

        match state {
            "JOB_STATE_QUEUED" | "JOB_STATE_PENDING" => return Ok(BatchPoll::Pending),
            "JOB_STATE_RUNNING" => return Ok(BatchPoll::Running),
            "JOB_STATE_CANCELLING" | "JOB_STATE_CANCELLED" => return Ok(BatchPoll::Cancelled),
            "JOB_STATE_EXPIRED" => {
                return Ok(BatchPoll::Failed {
                    error: "Zadanie wygasło (przekroczone okno 24h).".to_string(),
                });
            }
            "JOB_STATE_FAILED" => {
                let err_msg = op
                    .error
                    .as_ref()
                    .map(|e| e.message.clone())
                    .unwrap_or_else(|| "Zadanie zakończone błędem.".to_string());
                return Ok(BatchPoll::Failed { error: err_msg });
            }
            _ => {}
        }

        // Stany "SUCCEEDED" lub gdy operation.done=true z poprawną odpowiedzią
        let done = op.done.unwrap_or(false);
        let is_succeeded = state == "JOB_STATE_SUCCEEDED" || (done && op.response.is_some());
        if !is_succeeded {
            // Operation nieukończone, nieznany stan — traktujemy jako running
            return Ok(BatchPoll::Running);
        }

        let response = op
            .response
            .ok_or_else(|| "Brak pola response w ukończonym batchu.".to_string())?;

        // Spróbuj wyciągnąć inlinedResponses z różnych możliwych ścieżek:
        // - response.inlinedResponses.inlinedResponses[]
        // - response.responses.inlinedResponses[]
        // - response.inlinedResponses[]
        let inlined = response
            .get("inlinedResponses")
            .and_then(|v| v.get("inlinedResponses"))
            .or_else(|| {
                response
                    .get("responses")
                    .and_then(|v| v.get("inlinedResponses"))
            })
            .or_else(|| response.get("inlinedResponses"))
            .and_then(|v| v.as_array());

        let inlined = match inlined {
            Some(arr) => arr,
            None => {
                return Ok(BatchPoll::Failed {
                    error: "Brak inlinedResponses w wyniku batcha.".to_string(),
                });
            }
        };

        let mut images = Vec::new();
        for item in inlined {
            if let Some(err) = item.get("error") {
                let msg = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Nieznany błąd")
                    .to_string();
                return Ok(BatchPoll::Failed { error: msg });
            }
            let response = match item.get("response") {
                Some(r) => r,
                None => continue,
            };
            let imgs = extract_images_from_response(response)?;
            images.extend(imgs);
        }

        if images.is_empty() {
            return Ok(BatchPoll::Failed {
                error: "Batch ukończony ale brak obrazów w wyniku.".to_string(),
            });
        }
        Ok(BatchPoll::Succeeded { images })
    }

    async fn cancel_batch(&self, batch_id: &str) -> Result<(), String> {
        let key = read_key().await?;
        let client = build_client()?;

        let url = format!("{ENDPOINT_BASE}/{batch_id}:cancel?key={}", key);
        let resp = client
            .post(&url)
            .send()
            .await
            .map_err(|e| mask_key_in_error(&e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }
        Ok(())
    }
}
