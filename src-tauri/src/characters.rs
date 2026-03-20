use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CharacterSpriteAsset {
    emotion: String,
    path: String,
}

#[tauri::command]
pub async fn load_character_sprites() -> Result<Vec<CharacterSpriteAsset>, String> {
    let Some(root_dir) = find_character_directory() else {
        return Ok(Vec::new());
    };

    let index = build_file_index(&root_dir)?;
    let mut sprites = Vec::new();

    for (emotion, candidates) in emotion_candidates() {
        if let Some(path) = candidates
            .iter()
            .find_map(|candidate| index.get(*candidate).cloned())
        {
            sprites.push(CharacterSpriteAsset {
                emotion: emotion.to_string(),
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    Ok(sprites)
}

fn find_character_directory() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(home_dir) = dirs::home_dir() {
        candidates.push(
            home_dir
                .join(".clawtachie")
                .join("characters")
                .join("default"),
        );
    }

    if let Some(document_dir) = dirs::document_dir() {
        candidates.push(document_dir.join("ZcChat").join("characters").join("ATRI"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("characters").join("default"));
    }

    candidates
        .into_iter()
        .find(|path| path.exists() && path.is_dir())
}

fn build_file_index(root_dir: &Path) -> Result<HashMap<String, PathBuf>, String> {
    let mut index = HashMap::new();

    for entry in fs::read_dir(root_dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };

        if !extension.eq_ignore_ascii_case("png") {
            continue;
        }

        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };

        index
            .entry(stem.to_string())
            .or_insert_with(|| path.clone());
        index
            .entry(stem.to_lowercase())
            .or_insert_with(|| path.clone());
    }

    Ok(index)
}

fn emotion_candidates() -> [(&'static str, &'static [&'static str]); 8] {
    [
        ("normal", &["normal", "正常", "平静"]),
        ("smile", &["smile", "微笑"]),
        ("happy", &["happy", "开心", "高兴", "兴奋", "充满干劲"]),
        ("sad", &["sad", "难过", "伤心", "失落", "哭泣", "担心"]),
        ("angry", &["angry", "生气", "愤怒", "鄙视"]),
        ("surprised", &["surprised", "惊讶", "惊呆"]),
        ("thinking", &["thinking", "思考", "认真", "观望", "好奇"]),
        ("shy", &["shy", "害羞", "尴尬"]),
    ]
}
