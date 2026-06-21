use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

mod commands;
mod providers;

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

pub struct AppState {
    pub data_dir: std::path::PathBuf,
}

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("db/migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "material_categories",
            sql: include_str!("db/migrations/002_material_categories.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "material_pricing",
            sql: include_str!("db/migrations/003_material_pricing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "project_editor_state",
            sql: include_str!("db/migrations/004_project_editor_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "led_presets",
            sql: include_str!("db/migrations/005_led_presets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "led_presets_kelvin",
            sql: include_str!("db/migrations/006_led_presets_kelvin.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "led_presets_dedup",
            sql: include_str!("db/migrations/007_led_presets_dedup.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "prompt_presets",
            sql: include_str!("db/migrations/008_prompt_presets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "global_cutting_rates",
            sql: include_str!("db/migrations/009_global_cutting_rates.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "batch_jobs",
            sql: include_str!("db/migrations/010_batch_jobs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "batch_provider_id",
            sql: include_str!("db/migrations/011_batch_provider_id.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "app_settings",
            sql: include_str!("db/migrations/012_app_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "unique_project_name",
            sql: include_str!("db/migrations/013_unique_project_name.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "per_project_generation_state",
            sql: include_str!("db/migrations/014_per_project_generation_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "led_config",
            sql: include_str!("db/migrations/015_led_config.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "project_product_type",
            sql: include_str!("db/migrations/016_project_product_type.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "drop_cutting_rates",
            sql: include_str!("db/migrations/017_drop_cutting_rates.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "perspective_corners",
            sql: include_str!("db/migrations/018_perspective_corners.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "is_distance_category",
            sql: include_str!("db/migrations/019_is_distance_category.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "material_use_photo",
            sql: include_str!("db/migrations/020_material_use_photo.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "drop_material_photos",
            sql: include_str!("db/migrations/021_drop_material_photos.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "background_library",
            sql: include_str!("db/migrations/022_background_library.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "session_model_params",
            sql: include_str!("db/migrations/023_session_model_params.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "batch_job_params",
            sql: include_str!("db/migrations/024_batch_job_params.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:vizualizeit.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let docs_dir = app.path().document_dir()?;
            let data_dir = docs_dir.join("VizualizeIt");

            std::fs::create_dir_all(data_dir.join("projects"))?;

            app.manage(AppState { data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            commands::export::export_offer_pdf,
            commands::export::export_costs_pdf,
            commands::export::copy_image_to_path,
            commands::projects::create_project,
            commands::projects::delete_project,
            commands::projects::import_svg,
            commands::projects::import_background,
            commands::backgrounds::add_background,
            commands::backgrounds::delete_background,
            commands::generation::generate_image,
            commands::generation::edit_image_angle,
            commands::generation::edit_background_angle,
            commands::generation::edit_image_inpaint,
            commands::generation::edit_image_marked,
            commands::generation::get_abs_path,
            commands::generation::delete_image_file,
            commands::keyring::set_api_key,
            // commands::keyring::get_api_key świadomie NIE jest tu wystawione —
            // surowy klucz nie może wracać do webview. Komenda istnieje jako pub fn
            // używana wewnętrznie przez providery AI (google_ai.rs, openai.rs).
            // Frontend sprawdza obecność klucza przez `test_api_key` (zwraca bool).
            commands::keyring::delete_api_key,
            commands::keyring::test_api_key,
            commands::keyring::test_google_ai_connection,
            commands::keyring::test_openai_connection,
            commands::batch::save_batch_payload,
            commands::batch::delete_batch_payload,
            commands::batch::submit_batch_to_provider,
            commands::batch::poll_batch_status,
            commands::batch::cancel_batch_at_provider,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Błąd uruchamiania aplikacji Vizualize It: {e}");
            std::process::exit(1);
        });
}
