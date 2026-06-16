use crate::commands::path_guard::{check_within, check_within_parent, sanitize_filename};
use std::path::Path;

#[derive(Debug, serde::Serialize)]
pub struct AddBackgroundResult {
    /// Pełna ścieżka do skopiowanego pliku w data_dir/backgrounds/.
    pub path: String,
    /// MIME type (do zbudowania blob URL na froncie).
    pub mime: String,
    /// Oryginalna nazwa pliku (domyślna nazwa wyświetlana w bibliotece).
    pub name: String,
}

/// Kopiuje obraz tła do data_dir/backgrounds/ (globalna biblioteka teł).
/// Dodaje prefiks UUID żeby uniknąć kolizji nazw. Zwraca ścieżkę, MIME i oryginalną nazwę.
#[tauri::command]
pub async fn add_background(
    source_path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<AddBackgroundResult, String> {
    let src = Path::new(&source_path);

    let filename = src
        .file_name()
        .ok_or("Nieprawidłowa ścieżka pliku")?
        .to_string_lossy()
        .to_string();
    sanitize_filename(&filename)?;

    let ext = Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Err("Dozwolone są tylko pliki JPG, PNG i WebP".into());
    }

    let bg_dir = state.data_dir.join("backgrounds");
    std::fs::create_dir_all(&bg_dir)
        .map_err(|e| format!("Nie można utworzyć folderu teł: {e}"))?;

    let prefix = uuid::Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let dest_name = format!("{prefix}_{filename}");
    let dest_path = bg_dir.join(&dest_name);
    // Defense-in-depth obok sanitize_filename — guarduje wynik join przed wyjściem z bg_dir.
    check_within_parent(&state.data_dir, &dest_path)?;

    // read+write zamiast fs::copy — omija blokadę OneDrive/Defender (os error 32),
    // tak samo jak import_background.
    let bytes = std::fs::read(src)
        .map_err(|e| format!("Nie można odczytać pliku źródłowego: {e}"))?;
    std::fs::write(&dest_path, &bytes)
        .map_err(|e| format!("Nie można zapisać tła: {e}"))?;

    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };

    Ok(AddBackgroundResult {
        path: dest_path.to_string_lossy().to_string(),
        mime: mime.to_string(),
        name: filename,
    })
}

/// Usuwa plik tła z data_dir/backgrounds/. Metadane (wiersz w background_library)
/// kasuje frontend przez SQL. check_within guarduje przed wyjściem poza folder teł.
#[tauri::command]
pub async fn delete_background(
    path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let bg_dir = state.data_dir.join("backgrounds");
    check_within(&bg_dir, Path::new(&path))?;

    if Path::new(&path).exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Nie można usunąć tła: {e}"))?;
    }
    Ok(())
}
