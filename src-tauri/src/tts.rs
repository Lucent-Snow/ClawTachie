use std::{fs, path::PathBuf, process::Command};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const DEFAULT_MIMO_SCRIPT_PATH: &str = "E:\\Desktop\\code\\tts\\mimo-tts\\generate_mimo_tts.py";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSynthesizeRequest {
    provider: String,
    text: String,
    style: Option<String>,
    api_key: Option<String>,
    voice: Option<String>,
    model: Option<String>,
    script_path: Option<String>,
    user_context: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TtsSynthesizeResponse {
    path: String,
}

#[derive(Debug)]
struct PythonLauncher {
    program: String,
    prefix_args: Vec<String>,
}

#[tauri::command]
pub async fn tts_synthesize(
    request: TtsSynthesizeRequest,
) -> Result<TtsSynthesizeResponse, String> {
    tokio::task::spawn_blocking(move || synthesize(request))
        .await
        .map_err(|err| err.to_string())?
}

fn synthesize(request: TtsSynthesizeRequest) -> Result<TtsSynthesizeResponse, String> {
    match request.provider.as_str() {
        "mimo" => synthesize_mimo(request),
        other => Err(format!("unsupported tts provider: {other}")),
    }
}

fn synthesize_mimo(request: TtsSynthesizeRequest) -> Result<TtsSynthesizeResponse, String> {
    let text = request.text.trim().to_string();
    if text.is_empty() {
        return Err("tts text is empty".to_string());
    }

    let api_key = request.api_key.unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err("MiMo API key is empty".to_string());
    }

    let script_path = resolve_script_path(request.script_path.as_deref())?;
    let output_path = prepare_output_path("wav")?;
    let launcher = resolve_python_launcher()?;

    let mut command = Command::new(&launcher.program);
    command.args(&launcher.prefix_args);
    command.arg(&script_path);
    command.arg("--api-key").arg(api_key.trim());
    command.arg("--text").arg(text);
    command.arg("--output").arg(&output_path);
    command
        .arg("--voice")
        .arg(request.voice.unwrap_or_else(|| "default_zh".to_string()));
    command
        .arg("--model")
        .arg(request.model.unwrap_or_else(|| "mimo-v2-tts".to_string()));

    if let Some(style) = request
        .style
        .as_deref()
        .map(str::trim)
        .filter(|style| !style.is_empty())
    {
        command.arg("--style").arg(style);
    }

    if let Some(user_context) = request
        .user_context
        .as_deref()
        .map(str::trim)
        .filter(|context| !context.is_empty())
    {
        command.arg("--user-context").arg(user_context);
    }

    let output = command.output().map_err(|err| {
        format!(
            "failed to run MiMo script via {}: {}",
            launcher.program, err
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("MiMo synthesis failed: {detail}"));
    }

    if !output_path.exists() {
        return Err("MiMo synthesis finished without output audio".to_string());
    }

    Ok(TtsSynthesizeResponse {
        path: output_path.to_string_lossy().to_string(),
    })
}

fn resolve_script_path(candidate: Option<&str>) -> Result<PathBuf, String> {
    let script_path = candidate
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_MIMO_SCRIPT_PATH));

    if script_path.is_file() {
        return Ok(script_path);
    }

    Err(format!(
        "MiMo script not found: {}",
        script_path.to_string_lossy()
    ))
}

fn prepare_output_path(extension: &str) -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "home directory not found".to_string())?;
    let audio_dir = home_dir.join(".clawtachie").join("audio");
    fs::create_dir_all(&audio_dir).map_err(|err| err.to_string())?;
    Ok(audio_dir.join(format!("{}.{}", Uuid::new_v4(), extension)))
}

fn resolve_python_launcher() -> Result<PythonLauncher, String> {
    let candidates = [
        ("python", Vec::new()),
        ("python3", Vec::new()),
        ("py", vec!["-3".to_string()]),
    ];

    for (program, prefix_args) in candidates {
        let mut command = Command::new(program);
        command.args(&prefix_args);
        command.arg("--version");

        if command.output().is_ok() {
            return Ok(PythonLauncher {
                program: program.to_string(),
                prefix_args,
            });
        }
    }

    Err("python runtime not found (tried py, python, python3)".to_string())
}
