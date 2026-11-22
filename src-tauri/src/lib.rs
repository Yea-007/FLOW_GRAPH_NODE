pub mod desktop;
pub mod services;

use services::notes::{
    default_store, read_file_base64, AppConfig, AppError, Note, NoteDropPosition, NoteGroupTarget,
    NoteIcon, NoteMetadata, NoteReorderEntry, SaveNoteRequest, StyleDocument,
};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn app_name() -> &'static str {
    "花笺"
}

#[tauri::command]
fn notes_list() -> Result<Vec<NoteMetadata>, AppError> {
    default_store()?.list_notes()
}

#[tauri::command]
fn notes_get(id: String) -> Result<Note, AppError> {
    default_store()?.read_note(&id)
}

#[tauri::command]
fn notes_create(app: AppHandle, request: SaveNoteRequest) -> Result<Note, AppError> {
    let note = default_store()?.create_note(request)?;
    let _ = app.emit("notes-changed", &note.id);
    Ok(note)
}

#[tauri::command]
fn notes_update(app: AppHandle, id: String, request: SaveNoteRequest) -> Result<Note, AppError> {
    let note = default_store()?.update_note(&id, request)?;
    let _ = app.emit("notes-changed", &note.id);
    Ok(note)
}

#[tauri::command]
fn notes_save_grouped(
    app: AppHandle,
    id: Option<String>,
    request: SaveNoteRequest,
    group: NoteGroupTarget,
) -> Result<Note, AppError> {
    let note = default_store()?.save_grouped_note(id.as_deref(), request, group)?;
    let _ = app.emit("notes-changed", &note.id);
    Ok(note)
}

#[tauri::command]
fn notes_set_icon(id: String, icon: Option<NoteIcon>) -> Result<(), AppError> {
    default_store()?.set_note_icon(&id, icon)
}

#[tauri::command]
fn notes_get_styles(id: String) -> Result<Option<StyleDocument>, AppError> {
    default_store()?.read_note_styles(&id)
}

#[tauri::command]
fn notes_save_styles(id: String, document: StyleDocument) -> Result<(), AppError> {
    default_store()?.save_note_styles(&id, document)
}

#[tauri::command]
fn notes_delete(id: String) -> Result<(), AppError> {
    default_store()?.delete_note(&id)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, AppError> {
    read_file_base64(&path)
}

#[tauri::command]
fn notes_move(id: String, target_id: String, position: NoteDropPosition) -> Result<(), AppError> {
    default_store()?.move_note(&id, &target_id, position)
}

#[tauri::command]
fn notes_reorder(orders: Vec<NoteReorderEntry>) -> Result<(), AppError> {
    default_store()?.reorder_notes(orders)
}

#[tauri::command]
fn notes_import_markdown(path: String) -> Result<Note, AppError> {
    default_store()?.import_markdown_file(&PathBuf::from(path))
}

#[tauri::command]
fn notes_export_markdown(id: String, path: String) -> Result<(), AppError> {
    default_store()?.export_markdown_file(&id, &PathBuf::from(path))
}

#[tauri::command]
fn config_get() -> Result<AppConfig, AppError> {
    default_store()?.load_config()
}

#[tauri::command]
fn config_save(app: AppHandle, config: AppConfig) -> Result<AppConfig, AppError> {
    let store = default_store()?;
    let previous = store.load_config()?;
    desktop::apply_runtime_config(&app, &previous, &config).map_err(|error| AppError {
        code: "desktopConfig".into(),
        message: error.to_string(),
    })?;
    store.save_config(config.clone())?;
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

#[tauri::command]
async fn open_notepad_window(
    app: AppHandle,
    note_id: Option<String>,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_notepad_window(app, note_id, bounds).await
}

#[tauri::command]
async fn recycle_notepad_window(app: AppHandle, label: String) -> Result<(), AppError> {
    desktop::recycle_notepad_window(&app, &label)
}

#[tauri::command]
async fn open_tile_window(
    app: AppHandle,
    note_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_tile_window(app, note_id, bounds).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            desktop::setup_desktop(app)?;
            Ok(())
        })
        .on_window_event(desktop::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            app_name,
            notes_list,
            notes_get,
            notes_create,
            notes_update,
            notes_save_grouped,
            notes_set_icon,
            notes_get_styles,
            notes_save_styles,
            notes_delete,
            notes_import_markdown,
            notes_export_markdown,
            config_get,
            config_save,
            open_notepad_window,
            recycle_notepad_window,
            open_tile_window,
            read_file,
            notes_move,
            notes_reorder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
