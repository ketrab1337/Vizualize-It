use base64::Engine as _;
use reqwest::header;
use serde::{Deserialize, Serialize};

use super::{
    BatchPoll, BatchSubmit, GeneratedImage, GenerationConfig, ImageGenerator,
};
use crate::commands::keyring::get_api_key;

const GENERATIONS_ENDPOINT: &str = "https://api.openai.com/v1/images/generations";
const EDITS_ENDPOINT: &str = "https://api.openai.com/v1/images/edits";
// Uwaga: batch z obrazami używa endpointu "/v1/responses" (string w JSONL, nie pełny
// URL const) — to JEDYNY sposób na multi-image w OpenAI Batch API (multipart /v1/images/edits
// nie serializuje się do JSONL). Patrz komentarz w submit_batch.
const FILES_ENDPOINT: &str = "https://api.openai.com/v1/files";
const BATCHES_ENDPOINT: &str = "https://api.openai.com/v1/batches";
const FILE_CONTENT_TEMPLATE: &str = "https://api.openai.com/v1/files/{id}/content";
const MODEL: &str = "gpt-image-2";

// ── Request structures ────────────────────────────────────────────────────

// Payload dla /v1/images/generations zgodny z gpt-image-2.
// WAŻNE: brak pola `response_format` — gpt-image-2 (jak wcześniej gpt-image-1) zwraca
// zawsze base64 i ODRZUCA to pole. OpenAI nieintuicyjnie zwraca "model not found"
// zamiast "invalid parameter", co długo wyglądało jak problem z dostępem do modelu.
#[derive(Serialize)]
struct GenerationsRequest {
    model: String,
    prompt: String,
    n: u8,
    size: String,
    quality: String, // "auto" | "low" | "medium" | "high"
}

// ── Response structures ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct OpenAiResponse {
    data: Option<Vec<OpenAiImageData>>,
    error: Option<OpenAiError>,
}

#[derive(Deserialize)]
struct OpenAiImageData {
    b64_json: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiError {
    message: String,
}

// ── Batch API structures ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct FileUploadResponse {
    id: String,
}

#[derive(Serialize)]
struct BatchCreateRequest {
    input_file_id: String,
    endpoint: String,
    completion_window: String,
}

#[derive(Deserialize)]
struct BatchResponse {
    id: String,
    status: String,
    output_file_id: Option<String>,
    error_file_id: Option<String>,
    // input_file_id zachowany przez OpenAI w batch object — używany do best-effort
    // DELETE po sukcesie, żeby nie zostawiać orphan files na koncie usera.
    input_file_id: Option<String>,
    errors: Option<BatchErrors>,
}

/// Best-effort DELETE /v1/files/{id} — błędy ignorujemy. Wołane po sukcesie
/// batcha, żeby nie zaśmiecać konta OpenAI (każdy plik to koszt storage).
async fn delete_file_best_effort(client: &reqwest::Client, key: &str, file_id: &str) {
    let url = format!("{FILES_ENDPOINT}/{file_id}");
    let _ = client
        .delete(&url)
        .header(header::AUTHORIZATION, format!("Bearer {key}"))
        .send()
        .await;
}

#[derive(Deserialize)]
struct BatchErrors {
    data: Option<Vec<BatchErrorItem>>,
}

#[derive(Deserialize)]
struct BatchErrorItem {
    message: Option<String>,
}

/// Pojedyncza linia w wyjściowym pliku JSONL — odpowiedź na jedno żądanie z batcha.
#[derive(Deserialize)]
struct BatchOutputLine {
    response: Option<BatchOutputResponse>,
    error: Option<BatchOutputError>,
}

#[derive(Deserialize)]
struct BatchOutputResponse {
    status_code: u16,
    body: serde_json::Value,
}

#[derive(Deserialize)]
struct BatchOutputError {
    message: String,
}

// ── Provider ─────────────────────────────────────────────────────────────

pub struct OpenAiProvider;

impl OpenAiProvider {
    pub fn new() -> Self {
        Self
    }
}

fn map_api_error(status: u16, body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(msg) = v
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            // OpenAI często zwraca 400/404 z formułką "model ... not found" zamiast
            // 403 access denied. Wykrywamy ten wzorzec żeby user wiedział że to nie
            // bug aplikacji ani błędna nazwa modelu — tylko brak dostępu konta.
            let lower = msg.to_lowercase();
            let is_model_access = (status == 400 || status == 404)
                && lower.contains("model")
                && (lower.contains("not found") || lower.contains("does not exist") || lower.contains("no access"));
            if is_model_access {
                return format!(
                    "Brak dostępu do modelu gpt-image-2 dla Twojego konta. Mimo zweryfikowanej \
                     organizacji nowe modele wymagają osobnego rolloutu — często tier 1 nie wystarczy. \
                     Sprawdź na https://platform.openai.com/account/limits czy model jest na liście \
                     dostępnych, albo poczekaj kilka dni na rozszerzenie dostępu. Surowy komunikat \
                     OpenAI ({status}): {msg}"
                );
            }
            return match status {
                403 => format!(
                    "Błąd API OpenAI (403): brak dostępu — wymagana weryfikacja organizacji \
                     w OpenAI Developer Console. Szczegóły: {msg}"
                ),
                _ => format!("Błąd API OpenAI ({status}): {msg}"),
            };
        }
    }
    match status {
        400 => "Błąd API OpenAI (400): nieprawidłowe żądanie — sprawdź prompt i parametry.".into(),
        401 => "Błąd API OpenAI (401): nieprawidłowy klucz API.".into(),
        403 => {
            "Błąd API OpenAI (403): brak dostępu — wymagana weryfikacja organizacji \
             w OpenAI Developer Console."
                .into()
        }
        429 => "Błąd API OpenAI (429): przekroczono limit zapytań — spróbuj za chwilę.".into(),
        500..=599 => format!("Błąd serwera OpenAI ({status}) — spróbuj ponownie."),
        _ => format!("Błąd API OpenAI ({status})."),
    }
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Błąd inicjalizacji klienta HTTP: {e}"))
}

async fn read_key() -> Result<String, String> {
    let key = get_api_key("openai".to_string())
        .await?
        .ok_or_else(|| "Klucz OpenAI nie jest ustawiony.".to_string())?;
    if key.is_empty() {
        return Err("Klucz OpenAI jest pusty.".to_string());
    }
    Ok(key)
}

fn decode_b64_image(
    b64: Option<String>,
    width: u32,
    height: u32,
) -> Result<GeneratedImage, String> {
    let b64 = b64.ok_or_else(|| "Brak danych obrazu w odpowiedzi API.".to_string())?;
    let data = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| format!("Błąd dekodowania base64: {e}"))?;
    Ok(GeneratedImage {
        data,
        width,
        height,
        format: "image/png".to_string(),
    })
}

fn build_size_str(config: &GenerationConfig) -> (String, u32, u32) {
    let (width, height) = config.format.to_openai_dimensions();
    (format!("{width}x{height}"), width, height)
}

#[async_trait::async_trait]
impl ImageGenerator for OpenAiProvider {
    async fn generate(&self, config: GenerationConfig) -> Result<Vec<GeneratedImage>, String> {
        // Routing: są obrazy wejściowe → /v1/images/edits (multipart z image[] = scena
        // + materiały + referencje). Inaczej → /v1/images/generations (text-only).
        //
        // WAŻNE: /v1/responses NIE jest opcją bo top-level `model` musi tam być chat-modelem
        // (gpt-4o, gpt-5...), a `gpt-image-2` to image model — OpenAI zwraca wtedy 400
        // "model not found" co przez długi czas wyglądało jak brak dostępu do modelu.
        let has_inputs = config.background_image.is_some()
            || config.svg_image.is_some()
            || !config.material_images.is_empty()
            || !config.reference_images.is_empty();

        if has_inputs {
            return generate_via_edits(&config).await;
        }

        let key = read_key().await?;
        let (size, width, height) = build_size_str(&config);

        let request = GenerationsRequest {
            model: MODEL.to_string(),
            prompt: config.prompt.clone(),
            n: config.count,
            size,
            quality: "auto".to_string(),
        };

        let client = build_client()?;
        let resp = client
            .post(GENERATIONS_ENDPOINT)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Błąd sieci: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let openai_resp: OpenAiResponse = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania odpowiedzi API: {e}"))?;

        if let Some(err) = openai_resp.error {
            return Err(format!("Błąd API OpenAI: {}", err.message));
        }

        let items = openai_resp.data.unwrap_or_default();
        if items.is_empty() {
            return Err("API nie zwróciło żadnych obrazów. Sprawdź prompt.".to_string());
        }

        items
            .into_iter()
            .map(|item| decode_b64_image(item.b64_json, width, height))
            .collect()
    }

    async fn edit(
        &self,
        image: Vec<u8>,
        prompt: String,
        references: Vec<crate::providers::MaterialImage>,
    ) -> Result<GeneratedImage, String> {
        OpenAiProvider::edit_with_mask_inner(self, image, None, prompt, references).await
    }

    async fn submit_batch(&self, config: GenerationConfig) -> Result<BatchSubmit, String> {
        let key = read_key().await?;
        let client = build_client()?;

        // ── ŚWIADOMA NIESPÓJNOŚĆ Z `generate()` ────────────────────────────────
        // Live z obrazami używa `/v1/images/edits` (multipart, gpt-image-2 bezpośrednio).
        // Batch — NIE MOŻE używać `/v1/images/edits`, bo OpenAI Batch API obsługuje tylko
        // endpointy z JSONL body w jednej linii (`/v1/chat/completions`, `/v1/responses`,
        // `/v1/images/generations`, `/v1/embeddings`, `/v1/completions`). Multipart się nie
        // serializuje do JSONL — to fizyczne ograniczenie infrastruktury OpenAI Batch.
        //
        // Stąd dla batcha z obrazami JEDYNA opcja to `/v1/responses` z chat-modelem jako
        // orchestratorem (gpt-5.4-mini) i `image_generation` tool wywołującym gpt-image-2.
        // Wyniki MOGĄ się delikatnie różnić od live (orchestrator rephrase'uje prompt),
        // ale to nie jest do naprawy po stronie aplikacji.
        //
        // Bez obrazów — text-only `/v1/images/generations` zarówno live jak i batch (spójne).
        let has_inputs = config.background_image.is_some()
            || config.svg_image.is_some()
            || !config.material_images.is_empty()
            || !config.reference_images.is_empty();

        let lines: Vec<serde_json::Value> = if has_inputs {
            // /v1/responses zwraca 1 obraz na call → N linii JSONL dla count > 1
            let (body, _, _) = build_responses_body(&config);
            (0..config.count.max(1))
                .map(|idx| {
                    serde_json::json!({
                        "custom_id": format!("vizualizeit-request-{}", idx + 1),
                        "method": "POST",
                        "url": "/v1/responses",
                        "body": body,
                    })
                })
                .collect()
        } else {
            // BEZ response_format — gpt-image-2 odrzuca to pole (zwraca zawsze base64).
            let (size, _, _) = build_size_str(&config);
            let body = serde_json::json!({
                "model": MODEL,
                "prompt": config.prompt.clone(),
                "n": config.count,
                "size": size,
                "quality": "auto",
            });
            vec![serde_json::json!({
                "custom_id": "vizualizeit-request",
                "method": "POST",
                "url": "/v1/images/generations",
                "body": body,
            })]
        };

        let batch_endpoint = if has_inputs {
            "/v1/responses".to_string()
        } else {
            "/v1/images/generations".to_string()
        };

        // Każda linia w osobnej linii pliku (JSONL).
        let jsonl = lines
            .iter()
            .map(|l| serde_json::to_string(l).unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";

        // 1. Upload pliku JSONL (multipart, purpose=batch)
        let file_part = reqwest::multipart::Part::bytes(jsonl.into_bytes())
            .file_name("batch_input.jsonl")
            .mime_str("application/jsonl")
            .map_err(|e| format!("Błąd budowania formularza: {e}"))?;
        let form = reqwest::multipart::Form::new()
            .text("purpose", "batch")
            .part("file", file_part);

        let resp = client
            .post(FILES_ENDPOINT)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Błąd sieci przy uploadzie pliku batch: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let file: FileUploadResponse = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania odpowiedzi uploadu: {e}"))?;

        // 2. Utwórz batch — endpoint zgodny z tym co dali w JSONL linii
        let batch_req = BatchCreateRequest {
            input_file_id: file.id.clone(),
            endpoint: batch_endpoint.clone(),
            completion_window: "24h".to_string(),
        };
        let resp = client
            .post(BATCHES_ENDPOINT)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .json(&batch_req)
            .send()
            .await
            .map_err(|e| format!("Błąd sieci przy tworzeniu batcha: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let batch: BatchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania odpowiedzi batcha: {e}"))?;

        Ok(BatchSubmit {
            batch_id: batch.id,
            input_file_id: Some(file.id),
        })
    }

    async fn poll_batch(&self, batch_id: &str) -> Result<BatchPoll, String> {
        let key = read_key().await?;
        let client = build_client()?;

        let url = format!("{BATCHES_ENDPOINT}/{batch_id}");
        let resp = client
            .get(&url)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .send()
            .await
            .map_err(|e| format!("Błąd sieci przy pollowaniu batcha: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let batch: BatchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania statusu batcha: {e}"))?;

        match batch.status.as_str() {
            "validating" | "in_progress" | "finalizing" => {
                // 'validating' traktujemy jako pending, pozostałe jako running
                if batch.status == "validating" {
                    Ok(BatchPoll::Pending)
                } else {
                    Ok(BatchPoll::Running)
                }
            }
            "cancelling" | "cancelled" => Ok(BatchPoll::Cancelled),
            "failed" | "expired" => {
                let err_msg = batch
                    .errors
                    .as_ref()
                    .and_then(|e| e.data.as_ref())
                    .and_then(|d| d.first())
                    .and_then(|i| i.message.as_deref())
                    .map(String::from)
                    .unwrap_or_else(|| {
                        if batch.status == "expired" {
                            "Zadanie wygasło (przekroczone okno 24h).".to_string()
                        } else {
                            "Zadanie zakończone błędem.".to_string()
                        }
                    });
                Ok(BatchPoll::Failed { error: err_msg })
            }
            "completed" => {
                let output_file_id = batch
                    .output_file_id
                    .ok_or_else(|| "Batch ukończony ale brak output_file_id.".to_string())?;

                // Pobierz output JSONL
                let url = FILE_CONTENT_TEMPLATE.replace("{id}", &output_file_id);
                let resp = client
                    .get(&url)
                    .header(header::AUTHORIZATION, format!("Bearer {key}"))
                    .send()
                    .await
                    .map_err(|e| format!("Błąd pobierania pliku wynikowego: {e}"))?;

                if !resp.status().is_success() {
                    let status = resp.status().as_u16();
                    let body = resp.text().await.unwrap_or_default();
                    return Err(map_api_error(status, &body));
                }

                let text = resp
                    .text()
                    .await
                    .map_err(|e| format!("Błąd odczytu pliku wynikowego: {e}"))?;

                // Sprawdź też plik błędów (jeśli jest)
                if let Some(error_file_id) = &batch.error_file_id {
                    let url = FILE_CONTENT_TEMPLATE.replace("{id}", error_file_id);
                    if let Ok(resp) = client
                        .get(&url)
                        .header(header::AUTHORIZATION, format!("Bearer {key}"))
                        .send()
                        .await
                    {
                        if resp.status().is_success() {
                            if let Ok(err_text) = resp.text().await {
                                if !err_text.trim().is_empty() {
                                    return Ok(BatchPoll::Failed {
                                        error: format!(
                                            "Niektóre żądania zwróciły błąd: {}",
                                            err_text.lines().next().unwrap_or(&err_text)
                                        ),
                                    });
                                }
                            }
                        }
                    }
                }

                // Parsuj linie JSONL i wyciągnij obrazy.
                // Dwa możliwe formaty body (zależne od endpointu w submit_batch):
                // - /v1/images/generations → body.data[].b64_json
                // - /v1/responses → body.output[] z type="image_generation_call" i polem result
                let mut images = Vec::new();
                let (width, height) = (0u32, 0u32); // wymiary nieznane z batcha; obraz dekoduje PNG

                for line in text.lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let parsed: BatchOutputLine = serde_json::from_str(line)
                        .map_err(|e| format!("Błąd parsowania linii wynikowej: {e}"))?;
                    if let Some(err) = parsed.error {
                        return Ok(BatchPoll::Failed { error: err.message });
                    }
                    let response = match parsed.response {
                        Some(r) => r,
                        None => continue,
                    };
                    if response.status_code != 200 {
                        let msg = response
                            .body
                            .get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("Nieznany błąd");
                        return Ok(BatchPoll::Failed {
                            error: format!(
                                "Błąd ({}) z OpenAI: {}",
                                response.status_code, msg
                            ),
                        });
                    }

                    // Wariant Responses API: body.output[] z image_generation_call.result
                    if let Some(output) = response.body.get("output") {
                        let imgs = extract_responses_images(output, width, height, usize::MAX)?;
                        images.extend(imgs);
                        continue;
                    }

                    // Wariant /v1/images/generations: body.data[].b64_json
                    let data = response
                        .body
                        .get("data")
                        .and_then(|d| d.as_array())
                        .cloned()
                        .unwrap_or_default();
                    for item in data {
                        let b64 = item
                            .get("b64_json")
                            .and_then(|b| b.as_str())
                            .map(String::from);
                        images.push(decode_b64_image(b64, width, height)?);
                    }
                }

                if images.is_empty() {
                    return Ok(BatchPoll::Failed {
                        error: "Batch ukończony ale brak obrazów w wyniku.".to_string(),
                    });
                }

                // Best-effort sprzątanie plików po sukcesie batcha — bez tego pliki JSONL
                // (input + output) zostawały na koncie OpenAI generując koszty storage.
                delete_file_best_effort(&client, &key, &output_file_id).await;
                if let Some(input_id) = &batch.input_file_id {
                    delete_file_best_effort(&client, &key, input_id).await;
                }
                if let Some(error_id) = &batch.error_file_id {
                    delete_file_best_effort(&client, &key, error_id).await;
                }

                Ok(BatchPoll::Succeeded { images })
            }
            other => Err(format!("Nieznany status batcha OpenAI: '{other}'.")),
        }
    }

    async fn cancel_batch(&self, batch_id: &str) -> Result<(), String> {
        let key = read_key().await?;
        let client = build_client()?;

        let url = format!("{BATCHES_ENDPOINT}/{batch_id}/cancel");
        let resp = client
            .post(&url)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .send()
            .await
            .map_err(|e| format!("Błąd sieci przy anulowaniu batcha: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }
        Ok(())
    }
}

// ── Inpainting (inherent method — tylko OpenAI obsługuje maski) ──────────────

impl OpenAiProvider {
    /// Edycja obrazu z opcjonalną maską (inpainting).
    ///
    /// `mask` to PNG gdzie piksele PRZEZROCZYSTE (alpha=0) wyznaczają obszar do
    /// zmiany, a piksele nieprzezroczyste są zachowywane. Konwencja zgodna z
    /// `/v1/images/edits` OpenAI (DALL-E 2 / GPT Image).
    pub async fn edit_with_mask_inner(
        &self,
        image: Vec<u8>,
        mask: Option<Vec<u8>>,
        prompt: String,
        references: Vec<crate::providers::MaterialImage>,
    ) -> Result<GeneratedImage, String> {
        use base64::Engine as _;
        let key = read_key().await?;
        let client = build_client()?;

        // OpenAI /v1/images/edits przyjmuje wiele obrazów: pole `image[]` (multipart).
        // Pierwszy = ten do edycji, kolejne = referencyjne (wpływają na styl/treść).
        let main_part = reqwest::multipart::Part::bytes(image)
            .file_name("image.png")
            .mime_str("image/png")
            .map_err(|e| format!("Błąd budowania formularza: {e}"))?;

        // BEZ response_format — gpt-image-2 odrzuca to pole (analogicznie do /generations).
        // quality="auto" dla spójności z live generation (Playground też tak wysyła).
        let mut form = reqwest::multipart::Form::new()
            .part("image[]", main_part)
            .text("prompt", prompt)
            .text("model", MODEL)
            .text("quality", "auto");

        // Dodaj zdjęcia referencyjne (dekoduj z base64)
        for (idx, r) in references.into_iter().enumerate() {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&r.data)
                .map_err(|e| format!("Błąd dekodowania zdjęcia referencyjnego #{}: {e}", idx + 1))?;
            let ext = match r.mime_type.as_str() {
                "image/jpeg" | "image/jpg" => "jpg",
                "image/webp" => "webp",
                _ => "png",
            };
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(format!("ref_{}.{}", idx + 1, ext))
                .mime_str(&r.mime_type)
                .map_err(|e| format!("Błąd budowania formularza (ref #{}): {e}", idx + 1))?;
            form = form.part("image[]", part);
        }

        if let Some(mask_bytes) = mask {
            let mask_part = reqwest::multipart::Part::bytes(mask_bytes)
                .file_name("mask.png")
                .mime_str("image/png")
                .map_err(|e| format!("Błąd budowania formularza (maska): {e}"))?;
            form = form.part("mask", mask_part);
        }

        let resp = client
            .post(EDITS_ENDPOINT)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Błąd sieci: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(map_api_error(status, &body));
        }

        let openai_resp: OpenAiResponse = resp
            .json()
            .await
            .map_err(|e| format!("Błąd parsowania odpowiedzi API: {e}"))?;

        if let Some(err) = openai_resp.error {
            return Err(format!("Błąd API OpenAI: {}", err.message));
        }

        let item = openai_resp
            .data
            .unwrap_or_default()
            .into_iter()
            .next()
            .ok_or_else(|| "API nie zwróciło obrazu. Sprawdź prompt.".to_string())?;

        decode_b64_image(item.b64_json, 0, 0)
    }
}

// ── /v1/images/edits dla generowania z obrazami wejściowymi ───────────────
//
// Endpoint przyjmuje wiele obrazów w polu `image[]` (multipart). Konwencjonalnie:
// pierwszy = scena do "edycji" (tu: nasz composite tło+SVG), kolejne = referencje
// stylistyczne (materiały, zdjęcia inspiracyjne). Mask omitted → cały obraz edytowalny.
//
// Używamy zamiast /v1/responses bo Responses API wymaga chat-modelu na top-levelu,
// a my chcemy gpt-image-2 bezpośrednio.
async fn generate_via_edits(config: &GenerationConfig) -> Result<Vec<GeneratedImage>, String> {
    use base64::Engine as _;

    let key = read_key().await?;
    let client = build_client()?;
    let (size, width, height) = build_size_str(config);

    let format_suffix = config.format.to_prompt_suffix();
    let full_prompt = if format_suffix.is_empty() {
        config.prompt.clone()
    } else {
        format!("{} {}", config.prompt, format_suffix)
    };

    let mut form = reqwest::multipart::Form::new()
        .text("model", MODEL)
        .text("prompt", full_prompt)
        .text("n", config.count.to_string())
        .text("size", size)
        .text("quality", "auto".to_string());

    // Helper do dodawania obrazu w base64 jako part `image[]`
    let add_image_part = |form: reqwest::multipart::Form,
                          data_b64: &str,
                          mime: &str,
                          filename: String|
     -> Result<reqwest::multipart::Form, String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data_b64)
            .map_err(|e| format!("Błąd dekodowania obrazu '{filename}': {e}"))?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(filename.clone())
            .mime_str(mime)
            .map_err(|e| format!("Błąd budowania formularza '{filename}': {e}"))?;
        Ok(form.part("image[]", part))
    };

    // Kolejność: scena (svg composite albo tło) → materiały → referencje.
    // Pierwszy obraz to "główna" scena którą model będzie modyfikował.
    // Composite (svg_image) ma priorytet bo zawiera tło + nałożony szyld.
    if let Some(svg) = &config.svg_image {
        form = add_image_part(form, &svg.data, &svg.mime_type, "scene.png".to_string())?;
    } else if let Some(bg) = &config.background_image {
        form = add_image_part(form, &bg.data, &bg.mime_type, "scene.png".to_string())?;
    }

    for (idx, m) in config.material_images.iter().enumerate() {
        let ext = match m.mime_type.as_str() {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/webp" => "webp",
            _ => "png",
        };
        form = add_image_part(form, &m.data, &m.mime_type, format!("material_{}.{ext}", idx + 1))?;
    }

    for (idx, r) in config.reference_images.iter().enumerate() {
        let ext = match r.mime_type.as_str() {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/webp" => "webp",
            _ => "png",
        };
        form = add_image_part(form, &r.data, &r.mime_type, format!("ref_{}.{ext}", idx + 1))?;
    }

    let resp = client
        .post(EDITS_ENDPOINT)
        .header(header::AUTHORIZATION, format!("Bearer {key}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Błąd sieci: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(map_api_error(status, &body));
    }

    let openai_resp: OpenAiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Błąd parsowania odpowiedzi API: {e}"))?;

    if let Some(err) = openai_resp.error {
        return Err(format!("Błąd API OpenAI: {}", err.message));
    }

    let items = openai_resp.data.unwrap_or_default();
    if items.is_empty() {
        return Err("API nie zwróciło żadnych obrazów. Sprawdź prompt.".to_string());
    }

    items
        .into_iter()
        .map(|item| decode_b64_image(item.b64_json, width, height))
        .collect()
}

// ── Responses API (multi-image input dla gpt-image-2) ───────────────────────
//
// Endpoint /v1/responses akceptuje wieloobrazowy input. Wcześniej rozdzielaliśmy
// na role developer (techniczny) + user (swobodny). Teraz wszystko w jednej
// wiadomości user — pojedyncza, spójna instrukcja okazuje się stabilniejsza dla
// edycji obrazu.
//
// Obrazy są dołączane do tej wiadomości w polach `content`:
// - input_image z image_url=data URL base64 (obecny w naszym schemacie MaterialImage)
//
// Wynik wraca w `output[]` z elementem `type="image_generation_call"` i wynikiem
// w polu `result` (base64 PNG).

#[derive(Serialize)]
struct ResponsesRequest {
    model: String,
    input: Vec<ResponsesMessage>,
    tools: Vec<serde_json::Value>,
}

#[derive(Serialize)]
struct ResponsesMessage {
    role: String, // "user" — jedna rola dla całego promptu (techniczne + tekst użytkownika)
    content: Vec<ResponsesContent>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum ResponsesContent {
    Text {
        #[serde(rename = "type")]
        kind: &'static str, // "input_text"
        text: String,
    },
    Image {
        #[serde(rename = "type")]
        kind: &'static str, // "input_image"
        image_url: String, // pełny data URL: "data:image/png;base64,..."
    },
}

fn material_to_data_url(m: &super::MaterialImage) -> String {
    format!("data:{};base64,{}", m.mime_type, m.data)
}

/// Buduje body JSON dla Responses API — używane przez batch (`submit_batch` gdy są obrazy).
/// Live z obrazami idzie przez `/v1/images/edits` (multipart), więc Responses API zostało
/// tylko dla batcha (jedyny multi-image endpoint dostępny w OpenAI Batch). Zwraca też
/// (width, height) bo wymiary wynikowego obrazu są potrzebne przy dekodowaniu base64.
///
/// Jeden prompt = jedna wiadomość użytkownika z tekstem + obrazami. Wcześniej rozdzielenie
/// na role developer (techniczny) i user (swobodny) było eksperymentem — okazało się, że
/// scalenie do jednej wiadomości lepiej trzyma kontekst sceny przy edycji obrazu.
fn build_responses_body(config: &GenerationConfig) -> (serde_json::Value, u32, u32) {
    let format_suffix = config.format.to_prompt_suffix();
    let full_text = format!("{} {}", config.prompt, format_suffix);
    let mut user_content: Vec<ResponsesContent> = Vec::new();
    user_content.push(ResponsesContent::Text { kind: "input_text", text: full_text });

    if let Some(bg) = &config.background_image {
        user_content.push(ResponsesContent::Image {
            kind: "input_image",
            image_url: material_to_data_url(bg),
        });
    }
    if let Some(svg) = &config.svg_image {
        user_content.push(ResponsesContent::Image {
            kind: "input_image",
            image_url: material_to_data_url(svg),
        });
    }
    for m in &config.material_images {
        user_content.push(ResponsesContent::Image {
            kind: "input_image",
            image_url: material_to_data_url(m),
        });
    }
    for r in &config.reference_images {
        user_content.push(ResponsesContent::Image {
            kind: "input_image",
            image_url: material_to_data_url(r),
        });
    }

    let user_msg = ResponsesMessage { role: "user".to_string(), content: user_content };

    let (size_str, width, height) = build_size_str(config);
    // image_generation tool — `model` JEST w configu toola (a NIE w top-level requestu).
    // quality + size kopiujemy z live path żeby batch dawał takie same wyniki.
    let tool_config = serde_json::json!({
        "type": "image_generation",
        "model": MODEL,
        "size": size_str,
        "quality": "auto",
    });

    // Top-level model MUSI być chat-modelem (gpt-4o, gpt-5...). gpt-image-2 tu zwraca
    // 400 "model not found" — to nie chat model. gpt-5.4-mini jako orchestrator który
    // wywołuje image_generation tool — lepsze rozumienie promptu PL niż gpt-4o-mini,
    // wciąż tani per token.
    let request = ResponsesRequest {
        model: "gpt-5.4-mini".to_string(),
        input: vec![user_msg],
        tools: vec![tool_config],
    };

    let body = serde_json::to_value(&request).unwrap_or(serde_json::Value::Null);
    (body, width, height)
}

/// Wyciąga obrazy z `output[]` Responses API (filtruje po type=image_generation_call,
/// dekoduje base64 z pola result). Honoruje `max_count` — bierze maksymalnie tyle obrazów.
fn extract_responses_images(
    output: &serde_json::Value,
    width: u32,
    height: u32,
    max_count: usize,
) -> Result<Vec<GeneratedImage>, String> {
    let arr = output
        .as_array()
        .ok_or_else(|| "Pole output nie jest tablicą.".to_string())?;

    let mut images: Vec<GeneratedImage> = Vec::new();
    for item in arr {
        let is_image_call = item
            .get("type")
            .and_then(|t| t.as_str())
            .map(|s| s == "image_generation_call")
            .unwrap_or(false);
        if !is_image_call {
            continue;
        }
        if let Some(b64) = item.get("result").and_then(|r| r.as_str()) {
            images.push(decode_b64_image(Some(b64.to_string()), width, height)?);
        }
        if images.len() >= max_count {
            break;
        }
    }
    Ok(images)
}
