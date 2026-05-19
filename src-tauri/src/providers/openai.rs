use base64::Engine as _;
use reqwest::header;
use serde::{Deserialize, Serialize};

use super::{
    BatchPoll, BatchSubmit, GeneratedImage, GenerationConfig, ImageGenerator,
};
use crate::commands::keyring::get_api_key;

const GENERATIONS_ENDPOINT: &str = "https://api.openai.com/v1/images/generations";
const EDITS_ENDPOINT: &str = "https://api.openai.com/v1/images/edits";
const RESPONSES_ENDPOINT: &str = "https://api.openai.com/v1/responses";
const FILES_ENDPOINT: &str = "https://api.openai.com/v1/files";
const BATCHES_ENDPOINT: &str = "https://api.openai.com/v1/batches";
const FILE_CONTENT_TEMPLATE: &str = "https://api.openai.com/v1/files/{id}/content";
const MODEL: &str = "gpt-image-2";

// ── Request structures ────────────────────────────────────────────────────

#[derive(Serialize)]
struct GenerationsRequest {
    model: String,
    prompt: String,
    n: u8,
    size: String,
    response_format: String,
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
    #[allow(dead_code)]
    id: String,
    status: String,
    output_file_id: Option<String>,
    error_file_id: Option<String>,
    errors: Option<BatchErrors>,
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
        // Routing: są obrazy wejściowe (tło/SVG/materiały/referencje) → Responses API
        // (multi-image input + role developer/user). Inaczej → klasyczne /v1/images/generations
        // (text-only — OpenAI generations nie przyjmuje obrazów wejściowych).
        let has_inputs = config.background_image.is_some()
            || config.svg_image.is_some()
            || !config.material_images.is_empty()
            || !config.reference_images.is_empty();

        if has_inputs {
            return generate_via_responses(&config).await;
        }

        let key = read_key().await?;
        let (size, width, height) = build_size_str(&config);

        let request = GenerationsRequest {
            model: MODEL.to_string(),
            prompt: config.prompt.clone(),
            n: config.count,
            size,
            response_format: "b64_json".to_string(),
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

        // Dispatcher analogiczny do generate(): są obrazy wejściowe → batch przez /v1/responses
        // (multi-image + role developer/user). Brak → klasyczne /v1/images/generations.
        let has_inputs = config.background_image.is_some()
            || config.svg_image.is_some()
            || !config.material_images.is_empty()
            || !config.reference_images.is_empty();

        // /v1/responses zwraca 1 obraz na call, więc dla count>1 musimy N linii JSONL.
        // /v1/images/generations obsługuje natywnie `n` (1 linia = N obrazów).
        let lines: Vec<serde_json::Value> = if has_inputs {
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
            let (size, _, _) = build_size_str(&config);
            let body = serde_json::json!({
                "model": MODEL,
                "prompt": config.prompt.clone(),
                "n": config.count,
                "size": size,
                "response_format": "b64_json",
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

        let mut form = reqwest::multipart::Form::new()
            .part("image[]", main_part)
            .text("prompt", prompt)
            .text("model", MODEL)
            .text("response_format", "b64_json");

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

#[derive(Deserialize)]
struct ResponsesResponse {
    output: Option<Vec<ResponsesOutputItem>>,
    error: Option<OpenAiError>,
}

#[derive(Deserialize)]
struct ResponsesOutputItem {
    #[serde(rename = "type")]
    kind: Option<String>,
    /// Dla type="image_generation_call" — base64 PNG wynikowego obrazu.
    result: Option<String>,
}

fn material_to_data_url(m: &super::MaterialImage) -> String {
    format!("data:{};base64,{}", m.mime_type, m.data)
}

/// Buduje body JSON dla Responses API — używane przez live (`generate_via_responses`)
/// i przez batch (`submit_batch` gdy są obrazy). Zwraca też (width, height) bo wymiary
/// wynikowego obrazu są potrzebne przy dekodowaniu base64.
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
    let tool_config = serde_json::json!({
        "type": "image_generation",
        "size": size_str,
    });

    let request = ResponsesRequest {
        model: MODEL.to_string(),
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

/// Wykonuje pojedyncze wywołanie Responses API i zwraca dokładnie jeden obraz.
/// Responses API z image_generation tool zwraca 1 obraz na call (parametr `n` nie istnieje
/// dla tego toola — `n` działa tylko w /v1/images/generations).
async fn single_call_responses_api(
    client: reqwest::Client,
    key: String,
    body: serde_json::Value,
    width: u32,
    height: u32,
) -> Result<GeneratedImage, String> {
    let resp = client
        .post(RESPONSES_ENDPOINT)
        .header(header::AUTHORIZATION, format!("Bearer {key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Błąd sieci: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(map_api_error(status, &body));
    }

    let parsed: ResponsesResponse = resp
        .json()
        .await
        .map_err(|e| format!("Błąd parsowania odpowiedzi Responses API: {e}"))?;

    if let Some(err) = parsed.error {
        return Err(format!("Błąd API OpenAI: {}", err.message));
    }

    let output = parsed
        .output
        .ok_or_else(|| "API zwróciło odpowiedź bez pola output.".to_string())?;

    for item in output {
        if item.kind.as_deref() != Some("image_generation_call") {
            continue;
        }
        if let Some(b64) = item.result {
            return decode_b64_image(Some(b64), width, height);
        }
    }

    Err("API nie zwróciło obrazu w output[].".to_string())
}

async fn generate_via_responses(config: &GenerationConfig) -> Result<Vec<GeneratedImage>, String> {
    let key = read_key().await?;
    let client = build_client()?;
    let (body, width, height) = build_responses_body(config);

    // Responses API zwraca 1 obraz na wywołanie — żeby spełnić config.count, spawn N
    // wywołań równolegle. Każde wraca z jednym obrazem.
    let n = config.count.max(1) as usize;
    let mut handles = Vec::with_capacity(n);
    for _ in 0..n {
        let client = client.clone();
        let key = key.clone();
        let body = body.clone();
        handles.push(tokio::spawn(async move {
            single_call_responses_api(client, key, body, width, height).await
        }));
    }

    let mut images: Vec<GeneratedImage> = Vec::with_capacity(n);
    for h in handles {
        let res = h
            .await
            .map_err(|e| format!("Błąd zadania równoległego: {e}"))?;
        images.push(res?);
    }

    if images.is_empty() {
        return Err(
            "API nie zwróciło obrazu. Sprawdź czy gpt-image-2 obsługuje multimodalny input dla Twojego konta.".to_string(),
        );
    }
    Ok(images)
}
