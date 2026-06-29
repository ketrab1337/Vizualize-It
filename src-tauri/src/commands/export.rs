use crate::commands::path_guard::check_within;
use printpdf::*;
use serde::Deserialize;
use std::io::BufWriter;

// ── Typy dla PDF wyceny/kosztów ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CostLineItem {
    pub material_name: Option<String>,
    pub thickness_mm: Option<f64>,
    pub area_cm2: Option<f64>,
    pub path_length_m: Option<f64>,
    pub quantity: Option<f64>,
    pub total_cost: f64,
}

#[derive(Debug, Deserialize)]
pub struct GroupedCostItemInput {
    pub line_type: String, // "material" | "dystans" | "led"
    pub material_name: Option<String>,
    /// Czytelna nazwa typu/kategorii (np. „Pleksa") — prefiks w podsumowaniu. Opcjonalne (stary payload).
    #[serde(default)]
    pub category_label: Option<String>,
    pub thickness_mm: Option<f64>,
    pub total_area_cm2: Option<f64>,
    pub total_path_length_m: Option<f64>,
    pub total_quantity: Option<f64>,
    pub total_cost: f64,
}

#[derive(Debug, Deserialize)]
pub struct PdfCostsInput {
    pub project_name: String,
    pub save_path: String,
    pub items: Vec<CostLineItem>,
    /// Wiersze pogrupowane po (typ, materiał, grubość) — jeśli puste, użyj `items`.
    #[serde(default)]
    pub grouped_items: Vec<GroupedCostItemInput>,
    pub total_material: f64,
    pub total_cutting: f64,
    pub total_led: f64,
    pub grand_total: f64,
    pub margin_pct: f64,
    pub is_quote: bool, // true = wycena dla klienta, false = koszty własne
}

// ── Pomocnicze ────────────────────────────────────────────────────────────────

fn draw_table_row(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    y: f64,
    cols: &[(&str, f64)], // (tekst, x)
    font_size: f64,
) {
    for (text, x) in cols {
        layer.use_text(*text, font_size as f32, mm(*x), mm(y), font);
    }
}

fn format_pln(v: f64) -> String {
    format!("{:.2} zł", v)
}

fn apply_margin(cost: f64, is_quote: bool, margin_pct: f64) -> f64 {
    if is_quote { cost * (1.0 + margin_pct / 100.0) } else { cost }
}

// ── Komenda ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_costs_pdf(input: PdfCostsInput) -> Result<(), String> {
    let font_bytes = load_system_font()?;

    // A4 PIONOWO (210 × 297 mm)
    const PW: f64 = 210.0;
    const PH: f64 = 297.0;
    const M: f64 = 15.0; // margines

    let title = if input.is_quote {
        format!("Wycena — {}", input.project_name)
    } else {
        format!("Koszty własne — {}", input.project_name)
    };

    let (doc, first_page, first_layer) =
        PdfDocument::new(&title, mm(PW), mm(PH), "Tresc");

    let font = doc
        .add_external_font(std::io::Cursor::new(&font_bytes))
        .map_err(|e| format!("Błąd czcionki: {e}"))?;

    // ── Tabela GŁÓWNA (Podsumowanie pogrupowane) ───────────────────────────
    // Materiał = szeroka kolumna tekstowa (15→85). Kolumny numeryczne rozłożone
    // z RÓWNYM odstępem 22 mm (85, 107, 129, 151, 173), aby paddingi były spójne.
    let g_col_mat = M;
    let g_col_grub = 85.0;
    let g_col_pow = 107.0;
    let g_col_len = 129.0;
    let g_col_qty = 151.0;
    let g_col_total = 173.0;

    let draw_grouped_headers = |layer: &PdfLayerReference, y: f64| {
        draw_table_row(
            layer,
            &font,
            y,
            &[
                ("Materiał", g_col_mat),
                ("Grubość", g_col_grub),
                ("Pow.cm2", g_col_pow),
                ("Cięcie m", g_col_len),
                ("Ilość", g_col_qty),
                ("Wartość", g_col_total),
            ],
            8.5,
        );
    };

    let mut layer = doc.get_page(first_page).get_layer(first_layer);
    let mut y: f64 = PH - M - 4.0;

    // Nagłówek dokumentu
    let header = if input.is_quote { "WYCENA" } else { "KOSZTY WŁASNE" };
    layer.use_text(header, 18.0, mm(M), mm(y), &font);
    y -= 7.0;
    layer.use_text(&input.project_name, 12.0, mm(M), mm(y), &font);
    y -= 5.0;
    let today = chrono::Local::now().format("%d.%m.%Y").to_string();
    layer.use_text(&format!("Data: {}", today), 9.0, mm(M), mm(y), &font);
    y -= 10.0;

    let new_page = |doc: &PdfDocumentReference| -> (PdfLayerReference, f64) {
        let (np, nl) = doc.add_page(mm(PW), mm(PH), "Kontynuacja");
        let layer = doc.get_page(np).get_layer(nl);
        (layer, PH - M - 4.0)
    };

    // ── SEKCJA 1: Podsumowanie (pogrupowane) ───────────────────────────────
    layer.use_text("PODSUMOWANIE", 13.0, mm(M), mm(y), &font);
    y -= 7.0;
    draw_grouped_headers(&layer, y);
    y -= 6.5;

    // Jeśli grouped_items pusty (stary klient), pokaż items jako-jest.
    let groups = if input.grouped_items.is_empty() {
        // Fallback — z items zrób minimalne pseudo-grupy
        input
            .items
            .iter()
            .map(|i| GroupedCostItemInput {
                line_type: "material".into(),
                material_name: i.material_name.clone(),
                category_label: None,
                thickness_mm: i.thickness_mm,
                total_area_cm2: i.area_cm2,
                total_path_length_m: i.path_length_m,
                total_quantity: i.quantity,
                total_cost: i.total_cost,
            })
            .collect::<Vec<_>>()
    } else {
        input
            .grouped_items
            .iter()
            .map(|g| GroupedCostItemInput {
                line_type: g.line_type.clone(),
                material_name: g.material_name.clone(),
                category_label: g.category_label.clone(),
                thickness_mm: g.thickness_mm,
                total_area_cm2: g.total_area_cm2,
                total_path_length_m: g.total_path_length_m,
                total_quantity: g.total_quantity,
                total_cost: g.total_cost,
            })
            .collect()
    };

    for g in &groups {
        if y < M + 15.0 {
            let (new_layer, new_y) = new_page(&doc);
            layer = new_layer;
            y = new_y;
            draw_grouped_headers(&layer, y);
            y -= 6.5;
        }

        let display_cost = apply_margin(g.total_cost, input.is_quote, input.margin_pct);

        let mat_label = match g.line_type.as_str() {
            "led" => format!("LED — {}", g.material_name.as_deref().unwrap_or("—")),
            "dystans" => format!("Dystans — {}", g.material_name.as_deref().unwrap_or("—")),
            // Materiał — prefiks typem (np. „Pleksa — Plexa czerwona"), jeśli znamy kategorię.
            _ => {
                let name = g.material_name.as_deref().unwrap_or("—");
                match g.category_label.as_deref() {
                    Some(cat) if !cat.is_empty() => format!("{} — {}", cat, name),
                    _ => name.to_string(),
                }
            }
        };
        let mat_short = if mat_label.chars().count() > 38 {
            // .chars().take(N) zamiast slice'a bajtów — polskie znaki (ą, ć, ł)
            // zajmują 2 bajty UTF-8 i &str[..N] panikuje na granicy znaku.
            format!("{}…", mat_label.chars().take(37).collect::<String>())
        } else {
            mat_label
        };
        let grub = g
            .thickness_mm
            .map(|v| format!("{:.0}mm", v))
            .unwrap_or_else(|| "—".into());
        let pow = g
            .total_area_cm2
            .map(|v| format!("{:.1}", v))
            .unwrap_or_else(|| "—".into());
        // LED: długość taśmy idzie do kolumny „Ilość" (mb), kolumna „Cięcie" zostaje pusta.
        // Pozostałe materiały: długość → „Cięcie", sztuki → „Ilość".
        let (cie, qty) = if g.line_type == "led" {
            let q = g
                .total_path_length_m
                .map(|v| format!("{:.2} mb", v))
                .or_else(|| g.total_quantity.map(|v| format!("{:.0} szt.", v)))
                .unwrap_or_else(|| "—".into());
            ("—".to_string(), q)
        } else {
            let cie = g
                .total_path_length_m
                .map(|v| format!("{:.3}", v))
                .unwrap_or_else(|| "—".into());
            let qty = g
                .total_quantity
                .map(|v| format!("{:.0}", v))
                .unwrap_or_else(|| "—".into());
            (cie, qty)
        };

        draw_table_row(
            &layer,
            &font,
            y,
            &[
                (&mat_short, g_col_mat),
                (&grub, g_col_grub),
                (&pow, g_col_pow),
                (&cie, g_col_len),
                (&qty, g_col_qty),
                (&format_pln(display_cost), g_col_total),
            ],
            8.5,
        );
        y -= 6.5;
    }

    // ── Podsumowanie ogólne (pod tabelą głównego) ──────────────────────────
    y -= 5.0;
    if !input.is_quote {
        if y < M + 30.0 {
            let (nl, ny) = new_page(&doc);
            layer = nl;
            y = ny;
        }
        layer.use_text(
            &format!("Materiały:  {}", format_pln(input.total_material)),
            9.0,
            mm(g_col_total - 40.0),
            mm(y),
            &font,
        );
        y -= 6.0;
        layer.use_text(
            &format!("Cięcie:     {}", format_pln(input.total_cutting)),
            9.0,
            mm(g_col_total - 40.0),
            mm(y),
            &font,
        );
        y -= 6.0;
        layer.use_text(
            &format!("LED:        {}", format_pln(input.total_led)),
            9.0,
            mm(g_col_total - 40.0),
            mm(y),
            &font,
        );
        y -= 6.0;
    }

    let final_label = if input.is_quote { "RAZEM:" } else { "KOSZTY ŁĄCZNIE:" };
    let final_value = apply_margin(input.grand_total, input.is_quote, input.margin_pct);
    layer.use_text(
        &format!("{}  {}", final_label, format_pln(final_value)),
        11.0,
        mm(g_col_total - 50.0),
        mm(y - 2.0),
        &font,
    );

    let file = std::fs::File::create(&input.save_path)
        .map_err(|e| format!("Nie można zapisać pliku: {e}"))?;
    doc.save(&mut BufWriter::new(file))
        .map_err(|e| format!("Błąd zapisu PDF: {e}"))?;

    Ok(())
}

// ── Typy wejściowe ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ImageExportItem {
    pub file_path: String,
    pub model: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct MaterialSpecItem {
    pub label: String,
    pub material_name: Option<String>,
    pub color_name: Option<String>,
    pub has_distances: bool,
    pub distance_material_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LedExportConfig {
    pub backlit_enabled: bool,
    pub backlit_color_name: Option<String>,
    pub frontlit_enabled: bool,
    pub frontlit_color_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExportPdfInput {
    pub project_name: String,
    pub save_path: String,
    pub images: Vec<ImageExportItem>,
    pub materials: Vec<MaterialSpecItem>,
    pub led: LedExportConfig,
}

// ── Pomocnicze ────────────────────────────────────────────────────────────────

fn load_system_font() -> Result<Vec<u8>, String> {
    let candidates = [
        r"C:\Windows\Fonts\calibri.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\verdana.ttf",
        r"C:\Windows\Fonts\tahoma.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ];
    for path in &candidates {
        if let Ok(bytes) = std::fs::read(path) {
            return Ok(bytes);
        }
    }
    Err(
        "Nie znaleziono czcionki systemowej (Calibri, Arial, Verdana). \
         Sprawdź instalację systemu Windows."
            .into(),
    )
}

fn model_label(model: &str) -> &str {
    match model {
        "nano-banana-pro" => "Nano Banana Pro",
        "gpt-image-2" => "GPT Image 2",
        _ => "Nano Banana 2",
    }
}

// Skrót — printpdf 0.6 używa f32 w Mm
fn mm(v: f64) -> Mm {
    Mm(v as f32)
}

// ── Komenda ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_offer_pdf(
    input: ExportPdfInput,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    use printpdf::image_crate;

    let font_bytes = load_system_font()?;

    // A4 portrait
    const PW: f64 = 210.0;
    const PH: f64 = 297.0;
    const MARGIN: f64 = 20.0;

    let (doc, first_page, first_layer) = PdfDocument::new(
        &format!("Vizualize It — {}", input.project_name),
        mm(PW),
        mm(PH),
        "Treść",
    );

    let font = doc
        .add_external_font(std::io::Cursor::new(&font_bytes))
        .map_err(|e| format!("Błąd ładowania czcionki: {e}"))?;

    // ─────────────────────────────────────────────────────────────────────────
    // Strona 1 — nagłówek + specyfikacja
    // ─────────────────────────────────────────────────────────────────────────
    let spec = doc.get_page(first_page).get_layer(first_layer);
    let mut y: f64 = PH - MARGIN - 4.0;

    // Nagłówek
    spec.use_text("Vizualize It", 26.0, mm(MARGIN), mm(y), &font);
    y -= 10.0;

    spec.use_text(&input.project_name, 16.0, mm(MARGIN), mm(y), &font);
    y -= 7.0;

    let today = chrono::Local::now().format("%d.%m.%Y").to_string();
    spec.use_text(
        &format!("Oferta z dnia: {}", today),
        10.0,
        mm(MARGIN),
        mm(y),
        &font,
    );
    y -= 14.0;

    // Specyfikacja materiałów
    spec.use_text("Specyfikacja materiałów:", 13.0, mm(MARGIN), mm(y), &font);
    y -= 8.0;

    if input.materials.is_empty() {
        spec.use_text(
            "Brak przypisanych materiałów.",
            10.0,
            mm(MARGIN + 3.0),
            mm(y),
            &font,
        );
        y -= 7.0;
    } else {
        for mat in &input.materials {
            if y < MARGIN + 8.0 {
                break;
            }
            let mut line = format!("• {}", mat.label);
            if let Some(ref m) = mat.material_name {
                line.push_str(&format!("   {}", m));
            }
            if let Some(ref c) = mat.color_name {
                line.push_str(&format!(",  kolor: {}", c));
            }
            if mat.has_distances {
                let dm = mat.distance_material_name.as_deref().unwrap_or("tak");
                line.push_str(&format!(",  dystanse: {}", dm));
            }
            spec.use_text(&line, 10.0, mm(MARGIN + 3.0), mm(y), &font);
            y -= 6.5;
        }
    }
    y -= 8.0;

    // Konfiguracja LED
    if input.led.backlit_enabled || input.led.frontlit_enabled {
        if y > MARGIN + 20.0 {
            spec.use_text("Konfiguracja LED:", 13.0, mm(MARGIN), mm(y), &font);
            y -= 8.0;

            if input.led.backlit_enabled {
                let c = input.led.backlit_color_name.as_deref().unwrap_or("—");
                spec.use_text(
                    &format!("• Podświetlenie od tyłu:  {}", c),
                    10.0,
                    mm(MARGIN + 3.0),
                    mm(y),
                    &font,
                );
                y -= 6.5;
            }
            if input.led.frontlit_enabled {
                let c = input.led.frontlit_color_name.as_deref().unwrap_or("—");
                spec.use_text(
                    &format!("• Litery (front-lit):  {}", c),
                    10.0,
                    mm(MARGIN + 3.0),
                    mm(y),
                    &font,
                );
                y -= 6.5;
            }
            y -= 8.0;
        }
    }

    // Liczba wizualizacji
    if !input.images.is_empty() && y > MARGIN + 10.0 {
        let n = input.images.len();
        let label = match n {
            1 => "obraz",
            2..=4 => "obrazy",
            _ => "obrazow",
        };
        spec.use_text(
            &format!("Liczba wizualizacji: {} {}", n, label),
            10.0,
            mm(MARGIN),
            mm(y),
            &font,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Kolejne strony — jedna wizualizacja per strona
    // ─────────────────────────────────────────────────────────────────────────
    for item in &input.images {
        let abs_path = state.data_dir.join(&item.file_path);
        if check_within(&state.data_dir, &abs_path).is_err() {
            continue;
        }
        let img_bytes = match std::fs::read(&abs_path) {
            Ok(b) => b,
            Err(_) => continue,
        };

        let dyn_img = match image_crate::load_from_memory(&img_bytes) {
            Ok(img) => img,
            Err(_) => continue,
        };

        let img_w = dyn_img.width() as f64;
        let img_h = dyn_img.height() as f64;

        // Orientacja strony dopasowana do proporcji obrazu
        let (pw, ph) = if img_w > img_h {
            (297.0_f64, 210.0_f64) // pozioma
        } else {
            (210.0_f64, 297.0_f64) // pionowa
        };

        let (new_page, new_layer) = doc.add_page(mm(pw), mm(ph), "Obraz");
        let layer = doc.get_page(new_page).get_layer(new_layer);

        const IMG_MARGIN: f64 = 14.0;
        const CAPTION_H: f64 = 12.0;

        let avail_w = pw - IMG_MARGIN * 2.0;
        let avail_h = ph - IMG_MARGIN * 2.0 - CAPTION_H;

        // Rozmiar naturalny przy 150 DPI, skalowanie do dostępnego obszaru
        const DPI: f64 = 150.0;
        let nat_w = img_w * 25.4 / DPI;
        let nat_h = img_h * 25.4 / DPI;
        let scale = (avail_w / nat_w).min(avail_h / nat_h).min(1.0_f64);
        let final_w = nat_w * scale;
        let final_h = nat_h * scale;

        // Wyśrodkowanie
        let img_x = IMG_MARGIN + (avail_w - final_w) / 2.0;
        let img_y = CAPTION_H + IMG_MARGIN + (avail_h - final_h) / 2.0;

        // Konwersja do RGB8 (printpdf nie obsługuje alpha), re-enkodowanie jako PNG
        // żeby uzyskać ImageDecoder wymagany przez Image::try_from
        let rgb8 = dyn_img.to_rgb8();
        let mut png_buf: Vec<u8> = Vec::new();
        let enc = image_crate::codecs::png::PngEncoder::new(&mut png_buf);
        use image_crate::ImageEncoder as _;
        if enc
            .write_image(
                rgb8.as_raw(),
                rgb8.width(),
                rgb8.height(),
                image_crate::ColorType::Rgb8,
            )
            .is_err()
        {
            continue;
        }
        let decoder = match image_crate::codecs::png::PngDecoder::new(
            std::io::Cursor::new(png_buf),
        ) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let pdf_img = match Image::try_from(decoder) {
            Ok(img) => img,
            Err(_) => continue,
        };

        pdf_img.add_to_layer(
            layer.clone(),
            ImageTransform {
                translate_x: Some(mm(img_x)),
                translate_y: Some(mm(img_y)),
                dpi: Some(DPI as f32),
                scale_x: Some(scale as f32),
                scale_y: Some(scale as f32),
                rotate: None,
            },
        );

        // Podpis
        let model_str = model_label(&item.model);
        let date_str = &item.created_at[..item.created_at.len().min(10)];
        layer.use_text(
            &format!("{} — {}", model_str, date_str),
            9.0,
            mm(IMG_MARGIN),
            mm(IMG_MARGIN - 5.0),
            &font,
        );
    }

    // Zapis do pliku
    let file = std::fs::File::create(&input.save_path)
        .map_err(|e| format!("Nie można utworzyć pliku PDF: {e}"))?;
    doc.save(&mut BufWriter::new(file))
        .map_err(|e| format!("Błąd zapisu PDF: {e}"))?;

    Ok(())
}

/// Kopiuje plik z `data_dir` (zwalidowany przez `check_within`) do dowolnej
/// ścieżki wybranej przez użytkownika w dialogu zapisu.
#[tauri::command]
pub async fn copy_image_to_path(
    source_abs: String,
    dest_path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let src = std::path::PathBuf::from(&source_abs);
    check_within(&state.data_dir, &src)?;

    if !src.exists() {
        return Err(format!("Plik źródłowy nie istnieje: {source_abs}"));
    }

    let bytes = std::fs::read(&src)
        .map_err(|e| format!("Nie można odczytać pliku źródłowego: {e}"))?;
    std::fs::write(&dest_path, &bytes)
        .map_err(|e| format!("Nie można zapisać pliku w wybranej lokalizacji: {e}"))?;

    Ok(())
}
