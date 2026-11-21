//! Desktop shell. The UI and all audio live in the WebView; this side owns
//! system-wide key capture, the administrator checks, the tray icon, the
//! compact strip's window and the updater plugin.

mod chat;
mod input;
mod strip;

use std::sync::atomic::{AtomicBool, Ordering};

use input::{Binding, Source};
use tauri::Manager;

/// Set from Settings: closing the window hides it and voice keeps running.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);
/// Set by the tray's Quit, so that close really closes.
static QUITTING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn set_bindings(bindings: Vec<Binding>) {
    input::set_bindings(bindings);
}

#[tauri::command]
fn set_source(source: Source) {
    input::set_source(source);
}

#[tauri::command]
fn capture_next() {
    input::capture_next();
}

#[tauri::command]
fn restart_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    input::restart_as_admin()?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

/// The chat line in the strip got or lost the keyboard by itself: the player clicked in it, or away.
/// Seconds since the last key or mouse input anywhere on the computer (Windows' GetLastInputInfo). Only how
/// long, never which input: the app uses it to show the player as away after a quarter of an hour (decision 64).
#[tauri::command]
fn idle_seconds() -> u64 {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if GetLastInputInfo(&mut info) != 0 {
            return u64::from(GetTickCount().wrapping_sub(info.dwTime) / 1000);
        }
    }
    0
}

#[tauri::command]
fn chat_typing(on: bool) {
    chat::set_typing(on);
}

/// The chat line was sent or given up: the window that had the keyboard before gets it back.
/// Says whether Windows agreed.
#[tauri::command]
fn chat_done() -> bool {
    chat::give_back()
}

/// A button in the chat window was clicked, not its line: the game gets the keyboard back at once.
#[tauri::command]
fn chat_return() -> bool {
    chat::hand_back()
}

/// Brings the main window forward. The compact strip calls this when it is double-clicked.
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_main(&app);
}

/// Opens or closes the compact strip: a small always-on-top window, described
/// in tauri.conf.json, that shows who is speaking. It runs no voice of its own.
/// Async, because creating a window from a synchronous command can hang on Windows.
#[tauri::command]
async fn set_strip(app: tauri::AppHandle, show: bool, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    match (app.get_webview_window("strip"), show) {
        (Some(window), false) => window.close().map_err(|e| e.to_string()),
        (None, true) => {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "strip")
                .cloned()
                .ok_or_else(|| String::from("the strip window is not configured"))?;
            let window = tauri::WebviewWindowBuilder::from_config(&app, &config)
                .map_err(|e| e.to_string())?
                .build()
                .map_err(|e| e.to_string())?;
            if let (Some(x), Some(y)) = (x, y) {
                let _ = window.set_position(tauri::LogicalPosition::new(x, y));
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Puts the window in front of other programs' windows.
///
/// Windows only lets a program take the foreground if the user has just
/// clicked it. When the app is started by something else (the installer
/// restarting it after an update, or a second launch handing over to the copy
/// already running) a plain "focus" leaves it behind whatever is in front, and
/// the player has to go looking for it. Marking the window "always on top" is
/// allowed at any time, so it is marked for a moment and released: that leaves
/// it above the other windows without staying pinned there.
fn raise(window: &tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    let _ = window.set_always_on_top(false);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        raise(&window);
    }
}

/// Closes the window the normal way, so the page shuts its connections and
/// the player leaves voice at once, as with the window's own close button.
fn quit(app: &tauri::AppHandle) {
    QUITTING.store(true, Ordering::Relaxed);
    match app.get_webview_window("main") {
        Some(window) => {
            let _ = window.close();
        }
        None => app.exit(0),
    }
}

/// Tray icon: a left click brings the window back, the menu offers Open and Quit.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| String::from("Voice"));
    let open = MenuItem::with_id(app, "open", format!("Open {name}"), true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip(&name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn run() {
    let mut context = tauri::generate_context!();
    // WebView2 apps normally accept extra browser switches through this
    // variable. Because this app sets switches of its own, the variable is
    // otherwise ignored here, so add it explicitly. The automated test of the
    // installed app depends on it (debugging link, generated microphone).
    if let Ok(extra) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        for window in context.config_mut().app.windows.iter_mut() {
            let own = window.additional_browser_args.clone().unwrap_or_default();
            window.additional_browser_args = Some(format!("{own} {extra}").trim().to_string());
        }
    }

    tauri::Builder::default()
        // Must be registered first. A second launch (for example the browser
        // handing a sign-in link back) passes its arguments to the running
        // app and exits; the deep-link plugin then delivers the link.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            input::start(app.handle().clone());
            chat::watch();
            strip::watch(app.handle().clone());
            // Whoever started the app wants to see it: come to the front once the window exists.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(600));
                show_main(&handle);
            });
            // The app is usable without a tray icon, so a failure here is not fatal.
            if let Err(e) = build_tray(app) {
                eprintln!("tray icon: {e}");
            }
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the main window decides the app's life. The strip just closes.
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if CLOSE_TO_TRAY.load(Ordering::Relaxed) && !QUITTING.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                // With the main window gone the app is over, even if the strip is still open.
                tauri::WindowEvent::Destroyed => window.app_handle().exit(0),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_bindings,
            set_source,
            capture_next,
            restart_as_admin,
            set_close_to_tray,
            set_strip,
            show_main_window,
            chat_typing,
            chat_done,
            chat_return,
            idle_seconds
        ])
        .run(context)
        .expect("failed to start the app");
}
