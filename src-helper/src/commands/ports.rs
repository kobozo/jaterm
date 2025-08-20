use anyhow::Result;
use std::process::Command;

pub fn detect() -> Result<Vec<u16>> {
    let mut ports;
    
    // Try different methods based on OS
    #[cfg(target_os = "linux")]
    {
        ports = detect_linux()?;
    }
    
    #[cfg(target_os = "macos")]
    {
        ports = detect_macos()?;
    }
    
    #[cfg(target_os = "windows")]
    {
        ports = detect_windows()?;
    }
    
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        ports = vec![];
    }
    
    // Filter to common dev ports range and limit
    ports.retain(|&p| p > 1024);
    ports.sort_unstable();
    ports.dedup();
    ports.truncate(20);
    
    Ok(ports)
}

#[cfg(target_os = "linux")]
fn detect_linux() -> Result<Vec<u16>> {
    // Try ss first
    if let Ok(output) = Command::new("ss")
        .args(&["-tln"])
        .output()
    {
        if output.status.success() {
            return parse_ss_output(&String::from_utf8_lossy(&output.stdout));
        }
    }
    
    // Fallback to netstat
    if let Ok(output) = Command::new("netstat")
        .args(&["-tln"])
        .output()
    {
        if output.status.success() {
            return parse_netstat_output(&String::from_utf8_lossy(&output.stdout));
        }
    }
    
    Ok(vec![])
}

#[cfg(target_os = "macos")]
fn detect_macos() -> Result<Vec<u16>> {
    // Use netstat on macOS
    if let Ok(output) = Command::new("netstat")
        .args(&["-an"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return parse_netstat_macos(&stdout);
        }
    }
    
    // Fallback to lsof
    if let Ok(output) = Command::new("lsof")
        .args(&["-iTCP", "-sTCP:LISTEN", "-P", "-n"])
        .output()
    {
        if output.status.success() {
            return parse_lsof_output(&String::from_utf8_lossy(&output.stdout));
        }
    }
    
    Ok(vec![])
}

#[cfg(target_os = "windows")]
fn detect_windows() -> Result<Vec<u16>> {
    // Use netstat on Windows
    if let Ok(output) = Command::new("netstat")
        .args(&["-an"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return parse_netstat_windows(&stdout);
        }
    }
    
    Ok(vec![])
}

#[allow(dead_code)]
fn parse_ss_output(output: &str) -> Result<Vec<u16>> {
    let mut ports = Vec::new();
    
    for line in output.lines() {
        if !line.contains("LISTEN") {
            continue;
        }
        
        // Split by whitespace and look for the local address field
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            // Local address is typically in the 4th field
            if let Some(port) = extract_port_from_address(parts[3]) {
                ports.push(port);
            }
        }
    }
    
    Ok(ports)
}

#[allow(dead_code)]
fn parse_netstat_output(output: &str) -> Result<Vec<u16>> {
    let mut ports = Vec::new();
    
    for line in output.lines() {
        if !line.contains("LISTEN") && !line.contains("tcp") {
            continue;
        }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            // Local address is typically in the 4th field
            if let Some(port) = extract_port_from_address(parts[3]) {
                ports.push(port);
            }
        }
    }
    
    Ok(ports)
}

#[allow(dead_code)]
fn parse_netstat_macos(output: &str) -> Result<Vec<u16>> {
    let mut ports = Vec::new();
    
    for line in output.lines() {
        if !line.contains("LISTEN") {
            continue;
        }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            // On macOS, the local address uses dots as separators
            let addr = parts[3];
            
            // Handle both . and : as separators
            if let Some(port) = extract_port_from_macos_address(addr) {
                ports.push(port);
            }
        }
    }
    
    Ok(ports)
}

#[allow(dead_code)]
fn parse_netstat_windows(output: &str) -> Result<Vec<u16>> {
    let mut ports = Vec::new();
    
    for line in output.lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            // Local address is typically in the 2nd field on Windows
            if let Some(port) = extract_port_from_address(parts[1]) {
                ports.push(port);
            }
        }
    }
    
    Ok(ports)
}

#[allow(dead_code)]
fn parse_lsof_output(output: &str) -> Result<Vec<u16>> {
    let mut ports = Vec::new();
    
    for line in output.lines().skip(1) {
        // Skip header line
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 9 {
            // The NAME field is typically the 9th field (e.g., *:3000 or 127.0.0.1:3000)
            if let Some(port) = extract_port_from_address(parts[8]) {
                ports.push(port);
            }
        }
    }
    
    Ok(ports)
}

fn extract_port_from_address(addr: &str) -> Option<u16> {
    // Handle addresses like 127.0.0.1:3000, [::]:3000, *:3000
    if let Some(colon_pos) = addr.rfind(':') {
        let port_str = &addr[colon_pos + 1..];
        if let Ok(port) = port_str.parse::<u16>() {
            return Some(port);
        }
    }
    None
}

#[allow(dead_code)]
fn extract_port_from_macos_address(addr: &str) -> Option<u16> {
    // macOS netstat uses dots as separators (e.g., 127.0.0.1.3000)
    // Also handle IPv6 format with colons
    
    // First try colon separator (IPv6 or newer format)
    if addr.contains(':') {
        return extract_port_from_address(addr);
    }
    
    // Try dot separator (IPv4 on macOS)
    if let Some(last_dot) = addr.rfind('.') {
        let port_str = &addr[last_dot + 1..];
        if let Ok(port) = port_str.parse::<u16>() {
            // Make sure it's a valid port range
            if port > 1024 {
                return Some(port);
            }
        }
    }
    
    None
}