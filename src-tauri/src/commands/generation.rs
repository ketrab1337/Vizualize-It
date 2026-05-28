use crate::commands::path_guard::{check_within, validate_slug};
use serde::{Deserialize, Serialize};

// ── Typy danych wejściowych/wyjściowych ──────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct MaterialImageInput {
    pub data: String,
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleGenerateInput {
    pub project_slug: String,
    pub prompt: String,
    pub model: String,
    pub format: String,
    pub count: u8,
    pub material_images: Vec<MaterialImageInput>,
    pub background_image: Option<MaterialImageInput>,
    pub svg_image: Option<MaterialImageInput>,
    pub reference_images: Vec<MaterialImageInput>,
}

#[derive(Debug, Serialize)]
pub struct GeneratedImageFile {
    pub file_path: String,
    pub abs_path: String,
    pub mime_type: String,
}

// ── Komenda generowania ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_image(
    input: GoogleGenerateInput,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<GeneratedImageFile>, String> {
    use crate::providers::google_ai::GoogleAiProvider;
    use crate::providers::openai::OpenAiProvider;
    use crate::providers::{GenerationConfig, ImageGenerator, MaterialImage};
    use uuid::Uuid;

    validate_slug(&input.project_slug)?;

    let provider: Box<dyn ImageGenerator> = match input.model.as_str() {
        "nano-banana-pro" => Box::new(GoogleAiProvider::nano_banana_pro()),
        "nano-banana-2" => Box::new(GoogleAiProvider::nano_banana_2()),
        "gpt-image-2" => Box::new(OpenAiProvider::new()),
        other => return Err(format!("Nieznany model: '{other}'.")),
    };

    let format = parse_image_format(&input.format)?;

    let config = GenerationConfig {
        prompt: input.prompt,
        model: input.model.clone(),
        format,
        count: input.count,
        material_images: input
            .material_images
            .into_iter()
            .map(|m| MaterialImage { data: m.data, mime_type: m.mime_type })
            .collect(),
        background_image: input
            .background_image
            .map(|m| MaterialImage { data: m.data, mime_type: m.mime_type }),
        svg_image: input
            .svg_image
            .map(|m| MaterialImage { data: m.data, mime_type: m.mime_type }),
        reference_images: input
            .reference_images
            .into_iter()
            .map(|m| MaterialImage { data: m.data, mime_type: m.mime_type })
            .collect(),
    };

    let images = provider.generate(config).await?;

    let gen_dir = state
        .data_dir
        .join("projects")
        .join(&input.project_slug)
        .join("generated");
    std::fs::create_dir_all(&gen_dir)
        .map_err(|e| format!("Nie można utworzyć folderu wyjściowego: {e}"))?;

    let mut result = Vec::new();
    for img in images {
        let ext = mime_to_ext(&img.format);
        let filename = format!("{}.{}", Uuid::new_v4(), ext);
        let abs_path = gen_dir.join(&filename);
        std::fs::write(&abs_path, &img.data)
            .map_err(|e| format!("Nie można zapisać obrazu: {e}"))?;
        let rel_path = format!("projects/{}/generated/{}", input.project_slug, filename);
        result.push(GeneratedImageFile {
            file_path: rel_path,
            abs_path: abs_path.to_string_lossy().to_string(),
            mime_type: img.format,
        });
    }

    Ok(result)
}

// parse_image_format → crate::providers::ImageFormat::parse
// mime_to_ext → crate::providers::mime_to_ext
use crate::providers::{mime_to_ext, ImageFormat};
fn parse_image_format(s: &str) -> Result<ImageFormat, String> {
    ImageFormat::parse(s)
}

// ── Edycja kąta przez Google AI ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EditAngleInput {
    pub project_slug: String,
    pub file_path: String,
    pub camera_prompt: String,
    /// Model AI do edycji. Domyślnie `nano-banana-2`. Akceptuje też `nano-banana-pro`, `gpt-image-2`.
    #[serde(default)]
    pub model: Option<String>,
    /// Opcjonalne zdjęcia referencyjne dołączane do żądania edycji.
    #[serde(default)]
    pub reference_images: Vec<MaterialImageInput>,
}

fn map_reference_images(refs: Vec<MaterialImageInput>) -> Vec<crate::providers::MaterialImage> {
    refs.into_iter()
        .map(|r| crate::providers::MaterialImage { data: r.data, mime_type: r.mime_type })
        .collect()
}

/// Buduje providera dla operacji edycji obrazu (text + opcjonalna maska).
fn build_edit_provider(model: Option<&str>) -> Result<Box<dyn crate::providers::ImageGenerator>, String> {
    use crate::providers::google_ai::GoogleAiProvider;
    use crate::providers::openai::OpenAiProvider;
    use crate::providers::ImageGenerator;
    let m = model.unwrap_or("nano-banana-2");
    let provider: Box<dyn ImageGenerator> = match m {
        "nano-banana-pro" => Box::new(GoogleAiProvider::nano_banana_pro()),
        "nano-banana-2" => Box::new(GoogleAiProvider::nano_banana_2()),
        "gpt-image-2" => Box::new(OpenAiProvider::new()),
        other => return Err(format!("Nieznany model edycji: '{other}'.")),
    };
    Ok(provider)
}

#[tauri::command]
pub async fn edit_image_angle(
    input: EditAngleInput,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GeneratedImageFile, String> {
    use uuid::Uuid;

    validate_slug(&input.project_slug)?;
    let abs_src = state.data_dir.join(&input.file_path);
    check_within(&state.data_dir, &abs_src)?;

    let image_bytes = std::fs::read(&abs_src)
        .map_err(|e| format!("Nie można odczytać obrazu źródłowego: {e}"))?;

    let provider = build_edit_provider(input.model.as_deref())?;
    let refs = map_reference_images(input.reference_images);
    let result = provider.edit(image_bytes, input.camera_prompt, refs).await?;

    let gen_dir = state
        .data_dir
        .join("projects")
        .join(&input.project_slug)
        .join("generated");
    std::fs::create_dir_all(&gen_dir)
        .map_err(|e| format!("Nie można utworzyć folderu wyjściowego: {e}"))?;

    let ext = mime_to_ext(&result.format);
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let out_path = gen_dir.join(&filename);
    std::fs::write(&out_path, &result.data)
        .map_err(|e| format!("Nie można zapisać obrazu: {e}"))?;

    let rel_path = format!("projects/{}/generated/{}", input.project_slug, filename);
    Ok(GeneratedImageFile {
        file_path: rel_path,
        abs_path: out_path.to_string_lossy().to_string(),
        mime_type: result.format,
    })
}

// ── Edycja kąta ze ścieżki absolutnej (zdjęcie tła edytora) ──────────────────

#[derive(Debug, Deserialize)]
pub struct EditAngleAbsInput {
    pub project_slug: String,
    pub abs_path: String,
    pub camera_prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reference_images: Vec<MaterialImageInput>,
}

#[tauri::command]
pub async fn edit_background_angle(
    input: EditAngleAbsInput,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GeneratedImageFile, String> {
    use uuid::Uuid;

    validate_slug(&input.project_slug)?;
    check_within(&state.data_dir, std::path::Path::new(&input.abs_path))?;

    let image_bytes = std::fs::read(&input.abs_path)
        .map_err(|e| format!("Nie można odczytać pliku tła: {e}"))?;

    let provider = build_edit_provider(input.model.as_deref())?;
    let refs = map_reference_images(input.reference_images);
    let result = provider.edit(image_bytes, input.camera_prompt, refs).await?;

    let gen_dir = state
        .data_dir
        .join("projects")
        .join(&input.project_slug)
        .join("generated");
    std::fs::create_dir_all(&gen_dir)
        .map_err(|e| format!("Nie można utworzyć folderu wyjściowego: {e}"))?;

    let ext = mime_to_ext(&result.format);
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let out_path = gen_dir.join(&filename);
    std::fs::write(&out_path, &result.data)
        .map_err(|e| format!("Nie można zapisać obrazu: {e}"))?;

    let rel_path = format!("projects/{}/generated/{}", input.project_slug, filename);
    Ok(GeneratedImageFile {
        file_path: rel_path,
        abs_path: out_path.to_string_lossy().to_string(),
        mime_type: result.format,
    })
}

// ── Inpainting (obraz + maska + prompt → /v1/images/edits OpenAI) ───────────

#[derive(Debug, Deserialize)]
pub struct InpaintInput {
    pub project_slug: String,
    pub file_path: String,
    /// PNG maski jako base64 (bez prefiksu data URL). Piksele przezroczyste = obszar do zmiany.
    pub mask_base64: String,
    pub prompt: String,
    #[serde(default)]
    pub reference_images: Vec<MaterialImageInput>,
}

#[tauri::command]
pub async fn edit_image_inpaint(
    input: InpaintInput,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GeneratedImageFile, String> {
    use base64::Engine as _;
    use crate::providers::openai::OpenAiProvider;
    use uuid::Uuid;

    validate_slug(&input.project_slug)?;
    let abs_src = state.data_dir.join(&input.file_path);
    check_within(&state.data_dir, &abs_src)?;

    let image_bytes = std::fs::read(&abs_src)
        .map_err(|e| format!("Nie można odczytać obrazu źródłowego: {e}"))?;

    let mask_bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.mask_base64)
        .map_err(|e| format!("Błąd dekodowania maski base64: {e}"))?;

    let provider = OpenAiProvider::new();
    let refs = map_reference_images(input.reference_images);
    let result = provider
        .edit_with_mask_inner(image_bytes, Some(mask_bytes), input.prompt, refs)
        .await?;

    let gen_dir = state
        .data_dir
        .join("projects")
        .join(&input.project_slug)
        .join("generated");
    std::fs::create_dir_all(&gen_dir)
        .map_err(|e| format!("Nie można utworzyć folderu wyjściowego: {e}"))?;

    let ext = mime_to_ext(&result.format);
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let out_path = gen_dir.join(&filename);
    std::fs::write(&out_path, &result.data)
        .map_err(|e| format!("Nie można zapisać obrazu: {e}"))?;

    let rel_path = format!("projects/{}/generated/{}", input.project_slug, filename);
    Ok(GeneratedImageFile {
        file_path: rel_path,
        abs_path: out_path.to_string_lossy().to_string(),
        mime_type: result.format,
    })
}

// ── Edycja z visual marker (overlay maski wpalony w obraz) ─────────────────
//
// Używane dla modeli Google (Gemini / Nano Banana), które NIE obsługują
// natywnie masek przez API. Frontend komponuje obraz z półprzezroczystym
// czerwonym overlay-em w miejscu maski, a w prompcie instruuje model żeby
// edytował tylko ten zaznaczony obszar i zignorował sam kolor markera.
//
// Dla OpenAI używaj `edit_image_inpaint` — ma natywną maskę i daje lepsze
// wyniki niż visual marker.

#[derive(Debug, Deserialize)]
pub struct InpaintMarkedInput {
    pub project_slug: String,
    /// Skomponowany obraz (oryginał + visual overlay maski) jako base64 PNG (bez prefiksu data URL).
    pub image_base64: String,
    pub prompt: String,
    /// Model AI. Dla Google: `nano-banana-2` / `nano-banana-pro`. Default: `nano-banana-2`.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reference_images: Vec<MaterialImageInput>,
}

#[tauri::command]
pub async fn edit_image_marked(
    input: InpaintMarkedInput,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GeneratedImageFile, String> {
    use base64::Engine as _;
    use uuid::Uuid;

    validate_slug(&input.project_slug)?;

    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.image_base64)
        .map_err(|e| format!("Błąd dekodowania obrazu base64: {e}"))?;

    let provider = build_edit_provider(input.model.as_deref())?;
    let refs = map_reference_images(input.reference_images);
    let result = provider.edit(image_bytes, input.prompt, refs).await?;

    let gen_dir = state
        .data_dir
        .join("projects")
        .join(&input.project_slug)
        .join("generated");
    std::fs::create_dir_all(&gen_dir)
        .map_err(|e| format!("Nie można utworzyć folderu wyjściowego: {e}"))?;

    let ext = mime_to_ext(&result.format);
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let out_path = gen_dir.join(&filename);
    std::fs::write(&out_path, &result.data)
        .map_err(|e| format!("Nie można zapisać obrazu: {e}"))?;

    let rel_path = format!("projects/{}/generated/{}", input.project_slug, filename);
    Ok(GeneratedImageFile {
        file_path: rel_path,
        abs_path: out_path.to_string_lossy().to_string(),
        mime_type: result.format,
    })
}

// ── Odczyt pliku obrazu ──────────────────────────────────────────────────────

/// Zwraca absolutną ścieżkę do pliku obrazu po weryfikacji, że leży w data_dir.
/// Frontend używa jej razem z readFile (plugin-fs) zamiast base64.
#[tauri::command]
pub async fn get_abs_path(
    file_path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let abs_path = state.data_dir.join(&file_path);
    check_within(&state.data_dir, &abs_path)?;
    Ok(abs_path.to_string_lossy().to_string())
}

/// Usuwa plik obrazu z dysku po ścieżce relatywnej względem data_dir.
/// Jeśli plik nie istnieje — sukces (idempotentne).
#[tauri::command]
pub async fn delete_image_file(
    file_path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let abs_path = state.data_dir.join(&file_path);
    if abs_path.exists() {
        check_within(&state.data_dir, &abs_path)?;
        std::fs::remove_file(&abs_path)
            .map_err(|e| format!("Nie można usunąć pliku: {e}"))?;
    }
    Ok(())
}
