use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::{
    BatchPoll, BatchSubmit, GeneratedImage, GenerationConfig, ImageFormat, ImageGenerator,
};
use crate::commands::keyring::get_api_key;

const ENDPOINT_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

// ── Request structures ────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenConfig,
}

#[derive(Serialize, Clone)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize, Clone)]
#[serde(untagged)]
enum GeminiPart {
    Text { text: String },
    Inline {
        #[serde(rename = "inlineData")]
        inline_data: GeminiInlineData,
    },
}

#[derive(Serialize, Clone)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct GeminiGenConfig {
    #[serde(rename = "responseModalities")]
    response_modalities: Vec<String>,
    #[serde(rename = "candidateCount", skip_serializing_if = "Option::is_none")]
    candidate_count: Option<u8>,
    /// Temperatura sampling. Default Gemini = 1.0 (wysoka kreatywność, częsta mutacja
    /// tekstów i kolorów). Dla edycji-zachowującej (mockup, edit kąta) ustawiamy 0.35
    /// — model dużo wierniej trzyma się instrukcji o tekstach, kolorach i pixelach tła.
    /// Empirycznie: 1.0 → "Green-partners.pl" → "Green Partnership"; 0.35 → tekst zostaje.
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    /// Wymusza proporcję i rozdzielczość obrazu wynikowego. Bez tego Gemini zgadywał
    /// proporcję z promptu + obrazu wejściowego (px niezdefiniowane). Teraz output ma
    /// DOKŁADNIE proporcję canvasu. `imageSize` "2K" honoruje pro; flash może ograniczyć
    /// do 1K (zachowując proporcję) — to akceptowalny soft-degrade.
    #[serde(rename = "imageConfig", skip_serializing_if = "Option::is_none")]
    image_config: Option<GeminiImageConfig>,
}

#[derive(Serialize, Clone)]
struct GeminiImageConfig {
    #[serde(rename = "aspectRatio")]
    aspect_ratio: String,
    #[serde(rename = "imageSize")]
    image_size: String,
}

impl GeminiImageConfig {
    fn from_format(format: &ImageFormat, image_size: &str) -> Self {
        Self {
            aspect_ratio: format.to_google_aspect_ratio().to_string(),
            image_size: image_size.to_string(),
        }
    }
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
    // Pole `text` z odpowiedzi Gemini świadomie nie deserializowane — serde domyślnie
    // ignoruje nieznane pola. Image-preview modele rzadko zwracają text, a my potrzebujemy
    // tylko inlineData (base64 PNG/JPEG).
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

    /// Rozdzielczość obrazu wynikowego per model — dobrana tak, by koszt był IDENTYCZNY
    /// jak przed wprowadzeniem `imageConfig` (gdy modele dawały domyślnie 1K):
    /// - Pro: "2K" — u Gemini 3 Pro Image 1K i 2K są w tym samym progu cenowym
    ///   ($0.134/obraz), więc 2K to darmowy bonus jakości.
    /// - Flash: "1K" — u Flash Image 2K kosztuje więcej niż 1K, więc trzymamy 1K =
    ///   ta sama cena co wcześniej. Proporcja i tak wymuszana przez `aspectRatio`.
    fn image_size(&self) -> &'static str {
        if self.model.contains("pro") { "2K" } else { "1K" }
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
        400 => "Błąd API (400): nieprawidłowe żądanie — sprawdź prompt.".into(),
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
///
/// Kolejność parts: TEKST najpierw, potem obrazy w kolejności: kompozyt (lub czyste tło) →
/// materiały → referencje. Tekst na początku daje modelowi kontekst zanim "zobaczy" obrazy,
/// co stabilizuje wyniki (Google docs: "tekst instrukcji powinien poprzedzać obrazy
/// referencyjne"). Numeracja "Obraz 1, 2, ..." w prompcie odpowiada kolejności w parts.
fn build_request(config: &GenerationConfig, image_size: &str) -> GeminiRequest {
    let mut parts: Vec<GeminiPart> = Vec::new();

    // 1. TEKST PIERWSZY — opis zadania + opisy "Obraz 1, 2, 3..."
    let full_prompt = format!("{} {}", config.prompt, config.format.to_prompt_suffix());
    parts.push(GeminiPart::Text { text: full_prompt });

    // 2. Obrazy w kolejności zgodnej z numeracją w prompcie
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

    for img in &config.reference_images {
        parts.push(GeminiPart::Inline {
            inline_data: GeminiInlineData {
                mime_type: img.mime_type.clone(),
                data: img.data.clone(),
            },
        });
    }

    GeminiRequest {
        contents: vec![GeminiContent {
            role: "user".to_string(),
            parts,
        }],
        generation_config: GeminiGenConfig {
            // TEXT+IMAGE dla edycji — Gemini-3 wykorzystuje "thinking process" w tekście,
            // co stabilizuje wynik wizualny. Tekst odpowiedzi ignorujemy (extract_images
            // bierze tylko inline_data).
            response_modalities: vec!["TEXT".to_string(), "IMAGE".to_string()],
            // UWAGA: gemini-3.1-flash-image-preview i gemini-3-pro-image-preview NIE
            // wspierają candidateCount > 1 ("Multiple candidates is not enabled for this
            // model"). Dla count > 1 robimy N osobnych wywołań w `generate()` / submit_batch.
            candidate_count: None,
            // Temperatura z ustawień użytkownika; brak → 0.35 (default 1.0 powodował
            // mutację tekstów na szyldzie).
            temperature: config.temperature.or(Some(0.35)),
            image_config: Some(GeminiImageConfig::from_format(&config.format, image_size)),
        },
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
        }
    }
    Ok(images)
}

/// Pojedyncze wywołanie `:generateContent` zwracające 1 obraz.
/// Gemini image-preview modele NIE wspierają candidateCount > 1, więc dla count > 1
/// `generate()` spawnuje N równoległych wywołań tej funkcji.
async fn single_call_generate(
    client: reqwest::Client,
    url: String,
    request: GeminiRequest,
) -> Result<GeneratedImage, String> {
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
        .ok_or_else(|| "API zwróciło odpowiedź bez obrazów. Sprawdź prompt.".to_string())
}

#[async_trait::async_trait]
impl ImageGenerator for GoogleAiProvider {
    async fn generate(&self, config: GenerationConfig) -> Result<Vec<GeneratedImage>, String> {
        let key = read_key().await?;
        let request = build_request(&config, self.image_size());
        let url = format!("{}?key={}", self.generate_endpoint(), key);
        let client = build_client()?;

        // Gemini image-preview modele zwracają 1 obraz na call (candidateCount > 1
        // nie jest wspierany). Dla count > 1 spawnujemy N równoległych wywołań.
        let n = config.count.max(1) as usize;
        let mut handles = Vec::with_capacity(n);
        for _ in 0..n {
            let client = client.clone();
            let url = url.clone();
            let req = request.clone();
            handles.push(tokio::spawn(async move {
                single_call_generate(client, url, req).await
            }));
        }

        // Zbieramy udane obrazy; pojedyncze błędy (np. filtr SAFETY na jednym z N
        // równoległych wywołań) NIE odrzucają reszty. Błąd zwracamy tylko gdy ŻADEN
        // obraz się nie wygenerował — wtedy raportujemy pierwszy napotkany błąd.
        let mut images: Vec<GeneratedImage> = Vec::with_capacity(n);
        let mut first_error: Option<String> = None;
        for h in handles {
            match h.await {
                Ok(Ok(img)) => images.push(img),
                Ok(Err(e)) => {
                    if first_error.is_none() {
                        first_error = Some(e);
                    }
                }
                Err(e) => {
                    if first_error.is_none() {
                        first_error = Some(format!("Błąd zadania równoległego: {e}"));
                    }
                }
            }
        }

        if images.is_empty() {
            return Err(first_error
                .unwrap_or_else(|| "API nie zwróciło żadnego obrazu. Sprawdź prompt.".to_string()));
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

        // Kolejność parts spójna z build_request (live generation):
        // 1. TEKST najpierw — Google docs: "tekst instrukcji powinien poprzedzać obrazy"
        // 2. Obraz źródłowy do edycji
        // 3. Zdjęcia referencyjne (jeśli są)
        let mut parts: Vec<GeminiPart> = Vec::with_capacity(2 + references.len());
        parts.push(GeminiPart::Text { text: prompt });
        parts.push(GeminiPart::Inline {
            inline_data: GeminiInlineData {
                mime_type: mime_type.to_string(),
                data: image_b64,
            },
        });
        for r in references {
            parts.push(GeminiPart::Inline {
                inline_data: GeminiInlineData {
                    mime_type: r.mime_type,
                    data: r.data,
                },
            });
        }

        let request = GeminiRequest {
            contents: vec![GeminiContent {
                role: "user".to_string(),
                parts,
            }],
            generation_config: GeminiGenConfig {
                // TEXT+IMAGE — Gemini-3 "thinking process" w tekście stabilizuje edycję.
                response_modalities: vec!["TEXT".to_string(), "IMAGE".to_string()],
                candidate_count: None,
                temperature: Some(0.35),
                // Edycja (zmiana kąta / marker) — proporcję dyktuje obraz wejściowy,
                // NIE wymuszamy formatu (forsowanie aspectRatio zniekształciłoby kadr).
                image_config: None,
            },
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
        let request = build_request(&config, self.image_size());

        // Inlined batch z N żądaniami — Gemini image-preview NIE wspiera candidateCount > 1,
        // więc dla count > 1 wstawiamy N kopii tego samego żądania z różnymi metadata.key.
        // Każde żądanie zwróci 1 obraz; `poll_batch` zbierze wszystkie z inlinedResponses[].
        let n = config.count.max(1) as usize;
        let requests_array: Vec<serde_json::Value> = (0..n)
            .map(|idx| {
                serde_json::json!({
                    "request": request.clone(),
                    "metadata": { "key": format!("vizualize-it-{}", idx + 1) }
                })
            })
            .collect();

        let body = serde_json::json!({
            "batch": {
                "displayName": "vizualize-it-batch",
                "inputConfig": {
                    "requests": {
                        "requests": requests_array
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

        // Stan może być w metadata.state (starsze API) lub response.state (aktualne API).
        // Sprawdzamy oba miejsca defensywnie.
        let state_from_meta = op
            .metadata
            .as_ref()
            .and_then(|m| m.get("state"))
            .and_then(|s| s.as_str())
            .unwrap_or("");
        let state_from_resp = op
            .response
            .as_ref()
            .and_then(|r| r.get("state"))
            .and_then(|s| s.as_str())
            .unwrap_or("");
        let state = if !state_from_meta.is_empty() {
            state_from_meta
        } else {
            state_from_resp
        };

        // Aktualne API używa prefiksu BATCH_STATE_*, starsze JOB_STATE_* — akceptujemy oba.
        // Niektóre wersje API zwracają stany bez prefiksu (np. "SUCCEEDED").
        match state {
            "JOB_STATE_QUEUED" | "JOB_STATE_PENDING"
            | "BATCH_STATE_QUEUED" | "BATCH_STATE_PENDING"
            | "QUEUED" | "PENDING" => return Ok(BatchPoll::Pending),
            "JOB_STATE_RUNNING" | "BATCH_STATE_RUNNING" | "RUNNING" => return Ok(BatchPoll::Running),
            "JOB_STATE_CANCELLING" | "JOB_STATE_CANCELLED"
            | "BATCH_STATE_CANCELLING" | "BATCH_STATE_CANCELLED"
            | "CANCELLING" | "CANCELLED" => return Ok(BatchPoll::Cancelled),
            "JOB_STATE_EXPIRED" | "BATCH_STATE_EXPIRED" | "EXPIRED" => {
                return Ok(BatchPoll::Failed {
                    error: "Zadanie wygasło (przekroczone okno 24h).".to_string(),
                });
            }
            "JOB_STATE_FAILED" | "BATCH_STATE_FAILED" | "FAILED" => {
                let err_msg = op
                    .error
                    .as_ref()
                    .map(|e| e.message.clone())
                    .unwrap_or_else(|| "Zadanie zakończone błędem.".to_string());
                return Ok(BatchPoll::Failed { error: err_msg });
            }
            _ => {}
        }

        // Sukces: explicit state albo (done=true + jest response).
        let done = op.done.unwrap_or(false);
        let is_succeeded = state == "JOB_STATE_SUCCEEDED"
            || state == "BATCH_STATE_SUCCEEDED"
            || state == "SUCCEEDED"
            || (done && op.response.is_some());
        if !is_succeeded {
            // Operation nieukończone, nieznany stan — traktujemy jako running
            return Ok(BatchPoll::Running);
        }

        let response = op
            .response
            .ok_or_else(|| "Brak pola response w ukończonym batchu.".to_string())?;

        // Wyciągamy inlinedResponses ze wszystkich możliwych ścieżek (aktualnie i historycznie):
        // - response.output.inlinedResponses.inlinedResponses[]  (głęboka wersja — maj 2026)
        // - response.output.inlinedResponses[]                   (płaska wersja — output.inlinedResponses jest tablicą)
        // - response.inlinedResponses.inlinedResponses[]         (starsza struktura)
        // - response.responses.inlinedResponses[]                (jeszcze starsza)
        // - response.inlinedResponses[]                          (fallback flat)
        let inlined = response
            .get("output")
            .and_then(|o| o.get("inlinedResponses"))
            .and_then(|v| v.get("inlinedResponses"))
            .or_else(|| {
                // output.inlinedResponses jako bezpośrednia tablica (bez dodatkowego zagnieżdżenia)
                response
                    .get("output")
                    .and_then(|o| o.get("inlinedResponses"))
            })
            .or_else(|| {
                response
                    .get("inlinedResponses")
                    .and_then(|v| v.get("inlinedResponses"))
            })
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
