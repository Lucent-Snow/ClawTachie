fn normalize_proxy_value(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }

    if value.contains("://") {
        return Some(value.to_string());
    }

    let lower = value.to_ascii_lowercase();
    if lower.starts_with("socks=") {
        return Some(format!("socks5://{}", &value[6..]));
    }

    Some(format!("http://{value}"))
}

fn parse_windows_proxy_server(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if !trimmed.contains('=') {
        return normalize_proxy_value(trimmed);
    }

    let mut http_proxy: Option<String> = None;
    let mut https_proxy: Option<String> = None;
    let mut socks_proxy: Option<String> = None;
    let mut first_proxy: Option<String> = None;

    for segment in trimmed.split(';').map(str::trim).filter(|s| !s.is_empty()) {
        let Some((scheme, target)) = segment.split_once('=') else {
            continue;
        };

        let scheme = scheme.trim().to_ascii_lowercase();
        let normalized = match scheme.as_str() {
            "socks" | "socks5" => {
                let target = target.trim();
                if target.contains("://") {
                    target.to_string()
                } else {
                    format!("socks5://{target}")
                }
            }
            _ => normalize_proxy_value(target)?,
        };
        if first_proxy.is_none() {
            first_proxy = Some(normalized.clone());
        }

        match scheme.as_str() {
            "https" => https_proxy = Some(normalized),
            "http" => http_proxy = Some(normalized),
            "socks" | "socks5" => socks_proxy = Some(normalized),
            _ => {}
        }
    }

    https_proxy
        .or(http_proxy)
        .or(socks_proxy)
        .or(first_proxy)
}

fn detect_proxy_from_env() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ] {
        if let Ok(value) = std::env::var(key) {
            if let Some(proxy) = normalize_proxy_value(&value) {
                return Some(proxy);
            }
        }
    }

    None
}

#[cfg(windows)]
fn detect_proxy_from_windows_registry() -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let settings =
        hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings").ok()?;

    let enabled = settings.get_value::<u32, _>("ProxyEnable").ok().unwrap_or(0);
    if enabled == 0 {
        return None;
    }

    let proxy_server = settings.get_value::<String, _>("ProxyServer").ok()?;
    parse_windows_proxy_server(&proxy_server)
}

#[cfg(not(windows))]
fn detect_proxy_from_windows_registry() -> Option<String> {
    None
}

pub fn detect_updater_proxy() -> Option<String> {
    detect_proxy_from_env().or_else(detect_proxy_from_windows_registry)
}
