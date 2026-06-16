pub mod google_ai;
pub mod openai;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneratedImage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub format: String,
}

/// Obraz (base64) dołączany do żądania AI — tło, kompozyt SVG lub zdjęcie referencyjne.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MaterialImage {
    pub data: String,      // base64 (bez prefiksu data URL)
    pub mime_type: String, // "image/jpeg" | "image/png"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GenerationConfig {
    /// Pojedynczy prompt do AI — łączy w sobie automatycznie złożoną część (materiały,
    /// LED, kamera, tło, presety) i swobodny tekst użytkownika. Wcześniej rozdzielony
    /// na `prompt` (system) i `user_prompt` — eksperymentalnie połączony, bo pojedyncza
    /// instrukcja zdaje się lepiej trzymać kontekst sceny w generowaniu obrazu.
    pub prompt: String,
    pub model: String,
    pub format: ImageFormat,
    pub count: u8,
    /// Tło (zdjęcie ściany/lokalizacji) — opcjonalne, wysyłane przed promptem
    pub background_image: Option<MaterialImage>,
    /// Projekt SVG wyrenderowany do PNG — opcjonalne, wysyłane przed promptem
    pub svg_image: Option<MaterialImage>,
    /// Zdjęcia referencyjne dodane ręcznie przez użytkownika
    pub reference_images: Vec<MaterialImage>,
    /// Jakość gpt-image-2 ("low" | "medium" | "high"). None → "medium". Ignorowane przez Gemini.
    #[serde(default)]
    pub quality: Option<String>,
    /// Temperatura Gemini / Nano Banana. None → 0.35. Ignorowane przez OpenAI.
    #[serde(default)]
    pub temperature: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ImageFormat {
    #[serde(rename = "16:9")]
    Landscape16x9,
    #[serde(rename = "4:3")]
    Landscape4x3,
    #[serde(rename = "1:1")]
    Square,
    #[serde(rename = "3:4")]
    Portrait3x4,
    #[serde(rename = "9:16")]
    Portrait9x16,
}

impl ImageFormat {
    /// Parsuje stringowy identyfikator formatu (np. "16:9") z payloadu frontu.
    /// Wcześniej zduplikowane jako `parse_image_format` w `commands/generation.rs`
    /// i `commands/batch.rs` — teraz jedno źródło prawdy.
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "16:9" => Ok(Self::Landscape16x9),
            "4:3" => Ok(Self::Landscape4x3),
            "1:1" => Ok(Self::Square),
            "3:4" => Ok(Self::Portrait3x4),
            "9:16" => Ok(Self::Portrait9x16),
            _ => Err(format!("Nieznany format obrazu: {s}")),
        }
    }

    pub fn to_prompt_suffix(&self) -> &'static str {
        match self {
            Self::Landscape16x9 => "Wygeneruj obraz poziomy w proporcjach 16:9.",
            Self::Landscape4x3 => "Wygeneruj obraz poziomy w proporcjach 4:3.",
            Self::Square => "Wygeneruj obraz kwadratowy w proporcjach 1:1.",
            Self::Portrait3x4 => "Wygeneruj obraz pionowy w proporcjach 3:4.",
            Self::Portrait9x16 => "Wygeneruj obraz pionowy w proporcjach 9:16.",
        }
    }

    /// Mapuje MIME type obrazu na rozszerzenie pliku. Wcześniej zduplikowane
    /// jako `mime_to_ext` w `commands/generation.rs` i `commands/batch.rs`.
    /// Nie zależne od `ImageFormat`, ale logicznie pasuje obok parse().

    pub fn to_openai_dimensions(&self) -> (u32, u32) {
        // gpt-image-2 wspiera tylko: 1024×1024, 1024×1536 (portrait), 1536×1024 (landscape).
        // 4:3 i 9:16 nie mają dokładnego odpowiednika — mapujemy na najbliższy dozwolony
        // landscape/portrait, żeby API nie zwracało 400 "Unknown size".
        match self {
            Self::Landscape16x9 => (1536, 1024),
            Self::Landscape4x3 => (1536, 1024),
            Self::Square => (1024, 1024),
            Self::Portrait3x4 => (1024, 1536),
            Self::Portrait9x16 => (1024, 1536),
        }
    }
}

/// Mapuje MIME type zwrócony przez providera AI na rozszerzenie pliku do zapisu na dysku.
/// Jedyne źródło prawdy — wcześniej zduplikowane w `commands/generation.rs` i `commands/batch.rs`.
pub fn mime_to_ext(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

/// Wynik wysłania zadania do dostawcy Batch API.
#[derive(Debug, Serialize, Deserialize)]
pub struct BatchSubmit {
    /// ID zadania po stronie dostawcy (np. `batch_xxx` dla OpenAI, `batches/xxx` dla Google).
    pub batch_id: String,
    /// Tylko OpenAI: ID pliku wejściowego (do późniejszego usunięcia).
    pub input_file_id: Option<String>,
}

/// Status zadania batch — pobierane przez `poll_batch`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum BatchPoll {
    /// Zadanie zostało zaakceptowane, czeka na rozpoczęcie.
    Pending,
    /// Generowanie w toku.
    Running,
    /// Sukces — wynikowe obrazy (bajty) do zapisania.
    Succeeded { images: Vec<GeneratedImage> },
    /// Porażka — opis błędu z odpowiedzi dostawcy.
    Failed { error: String },
    /// Anulowane przez użytkownika lub system.
    Cancelled,
}

#[async_trait::async_trait]
pub trait ImageGenerator: Send + Sync {
    async fn generate(&self, config: GenerationConfig) -> Result<Vec<GeneratedImage>, String>;
    /// Edycja obrazu z opcjonalnymi zdjęciami referencyjnymi.
    /// `references` może być pusty — wtedy edycja idzie tylko z głównym obrazem + promptem.
    async fn edit(
        &self,
        image: Vec<u8>,
        prompt: String,
        references: Vec<MaterialImage>,
    ) -> Result<GeneratedImage, String>;

    /// Wysyła zadanie generowania do Batch API dostawcy. Zwraca ID zadania do późniejszego pollowania.
    async fn submit_batch(&self, config: GenerationConfig) -> Result<BatchSubmit, String>;

    /// Sprawdza status zadania batch. Jeśli ukończone — zwraca obrazy.
    async fn poll_batch(&self, batch_id: &str) -> Result<BatchPoll, String>;

    /// Anuluje zadanie batch po stronie dostawcy.
    async fn cancel_batch(&self, batch_id: &str) -> Result<(), String>;
}
