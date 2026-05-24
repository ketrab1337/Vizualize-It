use crate::commands::path_guard::validate_slug;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
}

#[tauri::command]
pub async fn create_project(
    input: CreateProjectInput,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Project, String> {
    use std::fs;
    use uuid::Uuid;

    let trimmed_name = input.name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Nazwa projektu nie może być pusta.".into());
    }

    let id = Uuid::new_v4().to_string();
    let slug = slugify(&trimmed_name);
    if slug.is_empty() {
        return Err("Nazwa projektu zawiera tylko znaki niedozwolone.".into());
    }
    let projects_root = state.data_dir.join("projects");
    let project_dir = projects_root.join(&slug);

    let now = chrono::Utc::now().to_rfc3339();

    fs::create_dir_all(project_dir.join("assets"))
        .map_err(|e| format!("Nie można utworzyć folderu projektu: {e}"))?;
    fs::create_dir_all(project_dir.join("generated"))
        .map_err(|e| format!("Nie można utworzyć folderu projektu: {e}"))?;

    Ok(Project {
        id,
        name: trimmed_name,
        slug,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn delete_project(
    id: String,
    slug: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let _ = id;
    validate_slug(&slug)?;
    let project_dir = state.data_dir.join("projects").join(&slug);
    if project_dir.exists() {
        std::fs::remove_dir_all(&project_dir)
            .map_err(|e| format!("Nie można usunąć folderu projektu '{slug}': {e}"))?;
    }
    Ok(())
}

#[derive(Debug, serde::Serialize)]
pub struct SvgImportResult {
    pub filename: String,
    pub content: String,
}

#[tauri::command]
pub async fn import_svg(
    slug: String,
    source_path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SvgImportResult, String> {
    validate_slug(&slug)?;

    let src = std::path::Path::new(&source_path);

    let filename = src
        .file_name()
        .ok_or("Nieprawidłowa ścieżka pliku")?
        .to_string_lossy()
        .to_string();

    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "svg" {
        return Err("Dozwolone są tylko pliki SVG".into());
    }

    let dest_dir = state.data_dir.join("projects").join(&slug).join("assets");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Nie można utworzyć folderu assets: {e}"))?;

    let dest_path = dest_dir.join(&filename);
    std::fs::copy(src, &dest_path)
        .map_err(|e| format!("Nie można skopiować pliku SVG: {e}"))?;

    let content = std::fs::read_to_string(&dest_path)
        .map_err(|e| format!("Nie można odczytać pliku SVG: {e}"))?;

    Ok(SvgImportResult { filename, content })
}

#[derive(Debug, serde::Serialize)]
pub struct BackgroundImportResult {
    pub path: String,
    pub mime: String,
}

#[tauri::command]
pub async fn import_background(
    slug: String,
    source_path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BackgroundImportResult, String> {
    validate_slug(&slug)?;

    let src = std::path::Path::new(&source_path);

    let filename = src
        .file_name()
        .ok_or("Nieprawidłowa ścieżka pliku")?
        .to_string_lossy()
        .to_string();

    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Err("Dozwolone są tylko pliki JPG, PNG i WebP".into());
    }

    let dest_dir = state.data_dir.join("projects").join(&slug).join("assets");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Nie można utworzyć folderu assets: {e}"))?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let dest_path = dest_dir.join(format!("bg_{ts}_{filename}"));

    // read+write zamiast fs::copy — omija blokadę OneDrive/Defender (os error 32)
    let bytes = std::fs::read(src)
        .map_err(|e| format!("Nie można odczytać pliku źródłowego: {e}"))?;
    std::fs::write(&dest_path, &bytes)
        .map_err(|e| format!("Nie można zapisać tła: {e}"))?;

    let path = dest_path.to_string_lossy().to_string();

    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };

    Ok(BackgroundImportResult { path, mime: mime.to_string() })
}

fn polish_to_ascii(c: char) -> char {
    match c {
        'ą' => 'a', 'ć' => 'c', 'ę' => 'e', 'ł' => 'l', 'ń' => 'n',
        'ó' => 'o', 'ś' => 's', 'ź' | 'ż' => 'z',
        'Ą' => 'A', 'Ć' => 'C', 'Ę' => 'E', 'Ł' => 'L', 'Ń' => 'N',
        'Ó' => 'O', 'Ś' => 'S', 'Ź' | 'Ż' => 'Z',
        _ => c,
    }
}

fn slugify(name: &str) -> String {
    name.chars()
        .map(polish_to_ascii)
        .map(|c| match c {
            'a'..='z' | '0'..='9' => c,
            'A'..='Z' => c.to_ascii_lowercase(),
            ' ' | '-' | '_' => '-',
            _ => '-',
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
