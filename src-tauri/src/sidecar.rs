use std::sync::Mutex;
use serde_json::Value;
use tauri::Emitter;

/// State for the sidecar process lifecycle.
pub struct SidecarState {
    /// Whether the sidecar has been started.
    pub started: bool,
    /// Next JSON-RPC request ID.
    next_id: u64,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            started: false,
            next_id: 1,
        }
    }

    pub fn next_request_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

/// Start the sidecar process using Tauri's shell plugin.
/// The sidecar communicates via stdin/stdout JSON-RPC.
/// Stdout lines are parsed and emitted as `sidecar-message` Tauri events.
/// Stderr is logged for debugging.
#[tauri::command]
pub fn start_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let mut sidecar_state = state.lock().map_err(|e| e.to_string())?;
    if sidecar_state.started {
        return Ok(());
    }
    sidecar_state.started = true;
    drop(sidecar_state);

    // Use Tauri shell plugin to spawn the sidecar
    // The frontend SidecarBridge will manage the actual process via @tauri-apps/plugin-shell
    // This Rust module provides the relay commands for IPC
    let _ = app.emit("sidecar-status", serde_json::json!({ "status": "ready" }));

    Ok(())
}

/// Send a JSON-RPC message to the sidecar via the frontend relay.
/// The frontend SidecarBridge manages the actual stdin/stdout communication.
/// This command constructs a JSON-RPC request and emits it for the bridge.
#[tauri::command]
pub fn sidecar_send(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<SidecarState>>,
    method: String,
    params: Value,
) -> Result<u64, String> {
    let mut sidecar_state = state.lock().map_err(|e| e.to_string())?;
    let id = sidecar_state.next_request_id();
    drop(sidecar_state);

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": id,
    });

    // Emit the request for the frontend SidecarBridge to write to stdin
    app.emit("sidecar-request", request)
        .map_err(|e| format!("Failed to emit sidecar request: {}", e))?;

    Ok(id)
}

/// Called by the frontend when it receives a line from sidecar stdout.
/// Parses the JSON-RPC response/notification and emits appropriate events.
#[tauri::command]
pub fn sidecar_receive(
    app: tauri::AppHandle,
    message: String,
) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(&message)
        .map_err(|e| format!("Invalid JSON from sidecar: {}", e))?;

    // Emit as a sidecar-message event for any listeners
    app.emit("sidecar-message", &parsed)
        .map_err(|e| format!("Failed to emit sidecar message: {}", e))?;

    Ok(())
}
