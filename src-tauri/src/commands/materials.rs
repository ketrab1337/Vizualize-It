use crate::commands::path_guard::{check_within, check_within_parent, sanitize_filename};
use std::path::Path;

/// Kopiuje zdjęcie referencyjne do ~/Documents/VizualizeIt/library/.
/// Dodaje prefiks UUID żeby uniknąć kolizji nazw.
/// Zwraca pełną ścieżkę do docelowego pliku.
#[tauri::command]
pub async fn copy_material_photo(
    source_path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
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
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
        return Err("Dozwolone są tylko pliki JPG, PNG, WebP i GIF".into());
    }

    let library_dir = state.data_dir.join("library");
    std::fs::create_dir_all(&library_dir)
        .map_err(|e| format!("Nie można utworzyć folderu biblioteki: {e}"))?;

    let prefix = uuid::Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let dest_name = format!("{prefix}_{filename}");
    let dest_path = library_dir.join(&dest_name);
    // Defense-in-depth obok sanitize_filename — guarduje wynik join przed wyjściem z library_dir.
    check_within_parent(&state.data_dir, &dest_path)?;

    std::fs::copy(src, &dest_path)
        .map_err(|e| format!("Nie można skopiować zdjęcia: {e}"))?;

    Ok(dest_path.to_string_lossy().to_string())
}

/// Odczytuje zdjęcie z dysku i zwraca jako data URL (base64).
#[tauri::command]
pub async fn get_material_photo(
    path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let library_dir = state.data_dir.join("library");
    check_within(&library_dir, Path::new(&path))?;

    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Nie można odczytać zdjęcia '{path}': {e}"))?;

    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpeg")
        .to_lowercase();

    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };

    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}
