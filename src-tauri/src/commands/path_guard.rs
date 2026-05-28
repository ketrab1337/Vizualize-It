use std::path::Path;

/// Waliduje slug projektu — tylko [a-z0-9-], bez wiodącego/kończącego myślnika.
pub fn validate_slug(s: &str) -> Result<(), String> {
    if s.is_empty() || s.starts_with('-') || s.ends_with('-') {
        return Err(format!("Nieprawidłowy slug projektu: '{s}'"));
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("Niedozwolone znaki w nazwie projektu: '{s}'"));
    }
    Ok(())
}

/// Sprawdza, że `child` leży wewnątrz `base` po rozwiązaniu dowiązań symbolicznych.
/// Wymaga istnienia obu ścieżek na dysku.
pub fn check_within(base: &Path, child: &Path) -> Result<(), String> {
    let base = base
        .canonicalize()
        .map_err(|e| format!("Nie można zweryfikować katalogu bazowego: {e}"))?;
    let child = child
        .canonicalize()
        .map_err(|_| "Plik nie istnieje lub ścieżka jest nieprawidłowa".to_string())?;
    if !child.starts_with(&base) {
        return Err("Dostęp do pliku poza dozwolonym katalogiem".into());
    }
    Ok(())
}

/// Wariant `check_within` dla zapisu plików które jeszcze nie istnieją.
/// Sprawdza, że PARENT `child`a leży wewnątrz `base` (canonicalize parenta).
/// Bez tego nie da się walidować destynacji w komendach typu `import_*` / `copy_*`,
/// bo `canonicalize` na nieistniejącej ścieżce zawsze rzuca błąd.
pub fn check_within_parent(base: &Path, child: &Path) -> Result<(), String> {
    let parent = child
        .parent()
        .ok_or_else(|| "Ścieżka nie ma rodzica".to_string())?;
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("Nie można zweryfikować katalogu bazowego: {e}"))?;
    let parent_canon = parent
        .canonicalize()
        .map_err(|_| "Katalog docelowy nie istnieje".to_string())?;
    if !parent_canon.starts_with(&base_canon) {
        return Err("Zapis pliku poza dozwolonym katalogiem".into());
    }
    Ok(())
}

/// Sanityzuje nazwę pliku — odrzuca separatory ścieżek, `..`, znaki zarezerwowane
/// przez Windows oraz znaki kontrolne. Defense-in-depth — uniemożliwia path traversal
/// nawet jeśli źródło `filename` zmieni się w przyszłości (np. dowolny string z JS).
pub fn sanitize_filename(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Nazwa pliku nie może być pusta".into());
    }
    if name == "." || name == ".." {
        return Err(format!("Niedozwolona nazwa pliku: '{name}'"));
    }
    for ch in name.chars() {
        match ch {
            '/' | '\\' => return Err(format!("Nazwa pliku zawiera separator ścieżki: '{name}'")),
            ':' | '<' | '>' | '"' | '|' | '?' | '*' => {
                return Err(format!("Nazwa pliku zawiera znak zarezerwowany: '{name}'"));
            }
            c if (c as u32) < 0x20 => {
                return Err(format!("Nazwa pliku zawiera znak kontrolny: '{name}'"));
            }
            _ => {}
        }
    }
    Ok(())
}
