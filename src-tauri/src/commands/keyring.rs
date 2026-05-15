use keyring::Entry;
use reqwest::header;

const KEYRING_SERVICE: &str = "vizualizeit";

#[tauri::command]
pub async fn set_api_key(account: String, key: String) -> Result<(), String> {
    let entry =
        Entry::new(KEYRING_SERVICE, &account).map_err(|e| format!("Błąd keyring: {e}"))?;
    entry
        .set_password(&key)
        .map_err(|e| format!("Nie można zapisać klucza API: {e}"))
}

#[tauri::command]
pub async fn get_api_key(account: String) -> Result<Option<String>, String> {
    let entry =
        Entry::new(KEYRING_SERVICE, &account).map_err(|e| format!("Błąd keyring: {e}"))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Nie można odczytać klucza API: {e}")),
    }
}

#[tauri::command]
pub async fn delete_api_key(account: String) -> Result<(), String> {
    let entry =
        Entry::new(KEYRING_SERVICE, &account).map_err(|e| format!("Błąd keyring: {e}"))?;
    entry
        .delete_password()
        .map_err(|e| format!("Nie można usunąć klucza API: {e}"))
}

#[tauri::command]
pub async fn test_api_key(account: String) -> Result<bool, String> {
    match get_api_key(account).await? {
        Some(key) => Ok(!key.is_empty()),
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn test_google_ai_connection() -> Result<(), String> {
    let key = get_api_key("google_ai".to_string())
        .await?
        .ok_or_else(|| "Klucz Google AI nie jest ustawiony.".to_string())?;
    if key.is_empty() {
        return Err("Klucz Google AI jest pusty.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            key
        ))
        .send()
        .await
        .map_err(|e| format!("Błąd sieci: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {} — sprawdź klucz API.", resp.status().as_u16()))
    }
}

#[tauri::command]
pub async fn test_openai_connection() -> Result<(), String> {
    let key = get_api_key("openai".to_string())
        .await?
        .ok_or_else(|| "Klucz OpenAI nie jest ustawiony.".to_string())?;
    if key.is_empty() {
        return Err("Klucz OpenAI jest pusty.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://api.openai.com/v1/models")
        .header(header::AUTHORIZATION, format!("Bearer {}", key))
        .send()
        .await
        .map_err(|e| format!("Błąd sieci: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {} — sprawdź klucz API.", resp.status().as_u16()))
    }
}
