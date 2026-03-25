mod characters;
mod gateway;
mod tts;

use tauri::{AppHandle, Manager};

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    window.show().map_err(|err| err.to_string())?;
    window.unminimize().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn start_current_window_dragging(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|err| err.to_string())
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_pet_window_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window not found".to_string())?;

    if visible {
        window.show().map_err(|err| err.to_string())?;
    } else {
        window.hide().map_err(|err| err.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .manage(gateway::GatewayState::default())
        .invoke_handler(tauri::generate_handler![
            characters::load_character_sprites,
            show_main_window,
            start_current_window_dragging,
            exit_app,
            set_pet_window_visible,
            tts::tts_synthesize,
            gateway::gateway_connect,
            gateway::gateway_disconnect,
            gateway::gateway_send_message,
            gateway::gateway_history,
            gateway::gateway_sessions_list,
            gateway::gateway_models_list,
            gateway::gateway_sessions_reset,
            gateway::gateway_sessions_patch,
            gateway::gateway_sessions_delete,
            gateway::gateway_chat_abort,
            gateway::gateway_config_get,
            gateway::gateway_config_schema,
            gateway::gateway_config_patch,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
