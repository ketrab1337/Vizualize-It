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
