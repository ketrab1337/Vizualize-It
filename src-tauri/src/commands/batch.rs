use crate::commands::path_guard::validate_slug;
use crate::providers::{
    google_ai::GoogleAiProvider, mime_to_ext, openai::OpenAiProvider, BatchPoll, BatchSubmit,
    GenerationConfig, ImageFormat, ImageGenerator, MaterialImage,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Waliduje, że `job_id` jest poprawnym UUID — zabezpieczenie przed path traversal w nazwie pliku.
fn validate_job_id(id: &str) -> Result<(), String> {
    Uuid::parse_str(id).map_err(|_| format!("Nieprawidłowe ID zadania: '{id}'"))?;
    Ok(())
}

fn build_provider(model: &str) -> Result<Box<dyn ImageGenerator>, String> {
    match model {
        "nano-banana-pro" => Ok(Box::new(GoogleAiProvider::nano_banana_pro())),
        "nano-banana-2" => Ok(Box::new(GoogleAiProvider::nano_banana_2())),
        "gpt-image-2" => Ok(Box::new(OpenAiProvider::new())),
        other => Err(format!("Nieznany model: '{other}'.")),
    }
}

fn parse_image_format(s: &str) -> Result<ImageFormat, String> {
    ImageFormat::parse(s)
}

// ── Payload zapisany przez frontend (taki sam jak GoogleGenerateInput) ──────

#[derive(Deserialize)]
struct PayloadMaterialImage {
    data: String,
    mime_type: String,
}

#[derive(Deserialize)]
struct StoredPayload {
    project_slug: String,
    prompt: String,
    model: String,
    format: String,
    count: u8,
    background_image: Option<PayloadMaterialImage>,
    svg_image: Option<PayloadMaterialImage>,
    reference_images: Vec<PayloadMaterialImage>,
    #[serde(default)]
    quality: Option<String>,
    #[serde(default)]
    temperature: Option<f32>,
}

fn payload_to_config(p: StoredPayload) -> Result<GenerationConfig, String> {
    let format = parse_image_format(&p.format)?;
    Ok(GenerationConfig {
        prompt: p.prompt,
        model: p.model,
        format,
        count: p.count,
        background_image: p
            .background_image
            .map(|m| MaterialImage { data: m.data, mime_type: m.mime_type }),
        svg_image: p
            .svg_image
            .map(|m| MaterialImage { data: m.data, mime_type: m.mime_type }),
        reference_images: p
            .reference_images
            .into_iter()
            .map(|m| MaterialImage { data: m.data, mime_type: m.mime_type })
            .collect(),
        quality: p.quality,
        temperature: p.temperature,
    })
}

// ── Save / load / delete payload (lokalny storage przed wysłaniem do dostawcy) ──

#[tauri::command]
pub async fn save_batch_payload(
    project_slug: String,
    job_id: String,
    payload_json: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    validate_slug(&project_slug)?;
    validate_job_id(&job_id)?;
    let dir = state
        .data_dir
        .join("projects")
        .join(&project_slug)
        .join("batch");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Nie można utworzyć folderu batch: {e}"))?;
    let path = dir.join(format!("{job_id}.json"));
    std::fs::write(&path, payload_json.as_bytes())
        .map_err(|e| format!("Nie można zapisać payloadu: {e}"))
}

#[tauri::command]
pub async fn delete_batch_payload(
    project_slug: String,
    job_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    validate_slug(&project_slug)?;
    validate_job_id(&job_id)?;
    let path = state
        .data_dir
        .join("projects")
        .join(&project_slug)
        .join("batch")
        .join(format!("{job_id}.json"));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Nie można usunąć payloadu: {e}"))?;
    }
    Ok(())
}

// ── Submit / poll / cancel batch po stronie dostawcy ────────────────────────

#[derive(Serialize)]
pub struct SubmitBatchOutput {
    pub batch_id: String,
    pub input_file_id: Option<String>,
}

/// Wysyła zadanie do Batch API dostawcy. Wczytuje payload z dysku, buduje request i przekazuje providerowi.
#[tauri::command]
pub async fn submit_batch_to_provider(
    job_id: String,
    project_slug: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SubmitBatchOutput, String> {
    validate_slug(&project_slug)?;
    validate_job_id(&job_id)?;

    let path = state
        .data_dir
        .join("projects")
        .join(&project_slug)
        .join("batch")
        .join(format!("{job_id}.json"));
    let payload_json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Nie można odczytać payloadu zadania: {e}"))?;

    let payload: StoredPayload = serde_json::from_str(&payload_json)
        .map_err(|e| format!("Błąd parsowania payloadu: {e}"))?;

    // Slug z payloadu musi się zgadzać ze ścieżką (defense in depth)
    if payload.project_slug != project_slug {
        return Err("Slug w payloadzie nie zgadza się ze ścieżką.".to_string());
    }

    let provider = build_provider(&payload.model)?;
    let config = payload_to_config(payload)?;

    let result: BatchSubmit = provider.submit_batch(config).await?;
    Ok(SubmitBatchOutput {
        batch_id: result.batch_id,
        input_file_id: result.input_file_id,
    })
}

/// Wynik pollowania zadania batch — odzwierciedla `BatchPoll` z providera.
/// Po sukcesie obrazy są zapisane na dysku, frontend dostaje tylko ścieżki.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum PollBatchOutput {
    Pending,
    Running,
    Succeeded { files: Vec<PollBatchFile> },
    Failed { error: String },
    Cancelled,
}

#[derive(Serialize)]
pub struct PollBatchFile {
    pub file_path: String,
    pub abs_path: String,
    pub mime_type: String,
}

#[tauri::command]
pub async fn poll_batch_status(
    job_id: String,
    project_slug: String,
    model: String,
    batch_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PollBatchOutput, String> {
    validate_slug(&project_slug)?;
    validate_job_id(&job_id)?;

    let provider = build_provider(&model)?;
    let result = provider.poll_batch(&batch_id).await?;

    match result {
        BatchPoll::Pending => Ok(PollBatchOutput::Pending),
        BatchPoll::Running => Ok(PollBatchOutput::Running),
        BatchPoll::Cancelled => Ok(PollBatchOutput::Cancelled),
        BatchPoll::Failed { error } => Ok(PollBatchOutput::Failed { error }),
        BatchPoll::Succeeded { images } => {
            let gen_dir = state
                .data_dir
                .join("projects")
                .join(&project_slug)
                .join("generated");
            std::fs::create_dir_all(&gen_dir)
                .map_err(|e| format!("Nie można utworzyć folderu wyjściowego: {e}"))?;

            let mut files = Vec::new();
            for img in images {
                let ext = mime_to_ext(&img.format);
                let filename = format!("{}.{}", Uuid::new_v4(), ext);
                let abs_path = gen_dir.join(&filename);
                std::fs::write(&abs_path, &img.data)
                    .map_err(|e| format!("Nie można zapisać obrazu: {e}"))?;
                let rel_path = format!("projects/{}/generated/{}", project_slug, filename);
                files.push(PollBatchFile {
                    file_path: rel_path,
                    abs_path: abs_path.to_string_lossy().to_string(),
                    mime_type: img.format,
                });
            }
            Ok(PollBatchOutput::Succeeded { files })
        }
    }
}

#[tauri::command]
pub async fn cancel_batch_at_provider(
    model: String,
    batch_id: String,
) -> Result<(), String> {
    let provider = build_provider(&model)?;
    provider.cancel_batch(&batch_id).await
}
